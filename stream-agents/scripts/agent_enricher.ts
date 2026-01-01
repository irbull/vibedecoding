/**
 * Enricher Agent
 *
 * Consumes `content.fetched` events from Kafka, calls OpenAI to generate
 * tags and summaries, and emits `enrichment.completed` events to Postgres.
 *
 * Uses Kafka-native KTable pattern for tag alignment:
 * - Consumes `tags.catalog` compacted topic to maintain known tags
 * - Passes known tags to LLM for consistency
 * - Emits new tags back to `tags.catalog`
 *
 * Run with: bun run agent:enricher
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer, getProducer, disconnectKafka } from '../src/lib/kafka';
import OpenAI from 'openai';
import type { Consumer, EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'enricher-agent-v1';
const EVENTS_TOPIC = 'events.raw';
const TAGS_TOPIC = 'tags.catalog';
const MODEL = 'gpt-4o-mini';
const MAX_CONTENT_CHARS = 32000; // ~8K tokens for cost control
const MAX_TAGS_IN_PROMPT = 100; // Limit tags in prompt to control size

// ============================================================
// Types
// ============================================================

interface LifestreamEvent {
  id: string;
  occurred_at: string;
  received_at: string;
  source: string;
  subject: string;
  subject_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
  causation_id?: string;
}

interface EnrichmentResult {
  tags: string[];
  summary_short: string;
  summary_long: string;
  language: string;
}

// ============================================================
// OpenAI Client
// ============================================================

const openai = new OpenAI();

// ============================================================
// Tag Catalog State (KTable)
// ============================================================

const knownTags = new Set<string>();

async function updateTagCatalog(newTags: string[]): Promise<void> {
  const actuallyNew = newTags.filter(t => !knownTags.has(t));

  if (actuallyNew.length === 0) return;

  // Add to local state
  actuallyNew.forEach(t => knownTags.add(t));

  // Emit updated catalog to Kafka
  try {
    const producer = await getProducer();
    await producer.send({
      topic: TAGS_TOPIC,
      messages: [{
        key: 'all',
        value: JSON.stringify(Array.from(knownTags))
      }]
    });

    console.log(`[enricher] Added ${actuallyNew.length} new tags: ${actuallyNew.join(', ')}`);
  } catch (err) {
    console.error(`[enricher] Failed to update tag catalog:`, err);
    // Continue anyway - local state is still updated
  }
}

// ============================================================
// Idempotency
// ============================================================

async function alreadyEnriched(subjectId: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM lifestream.link_metadata
    WHERE subject_id = ${subjectId}
      AND array_length(tags, 1) > 0
  `;
  return result.length > 0;
}

// ============================================================
// LLM Enrichment
// ============================================================

async function enrichContent(
  title: string | null,
  textContent: string,
  existingTags: Set<string>
): Promise<EnrichmentResult> {
  // Truncate content for cost control
  const truncated = textContent.slice(0, MAX_CONTENT_CHARS);

  // Build tag list for prompt (limit size)
  const tagList = Array.from(existingTags).slice(0, MAX_TAGS_IN_PROMPT).join(', ');

  const prompt = `Analyze this article and provide tags and summaries.

EXISTING TAGS (prefer these when appropriate, but create new ones if needed):
${tagList || '(none yet)'}

Rules for tags:
- Use 3-7 tags per article
- Prefer existing tags when they fit
- New tags should be lowercase, hyphenated (e.g., "machine-learning", "web-development")
- Be specific but not too narrow

${title ? `Title: ${title}\n\n` : ''}Content:
${truncated}

Respond ONLY with valid JSON in this exact format:
{
  "tags": ["tag1", "tag2"],
  "summary_short": "1-2 sentences, max 200 chars",
  "summary_long": "2-3 paragraphs",
  "language": "en"
}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return JSON.parse(content) as EnrichmentResult;
}

// ============================================================
// Event Emission
// ============================================================

async function emitEnrichmentCompleted(
  subjectId: string,
  result: EnrichmentResult,
  correlationId?: string
): Promise<void> {
  const payload = {
    tags: result.tags,
    summary_short: result.summary_short,
    summary_long: result.summary_long,
    language: result.language,
    model_version: MODEL,
  };

  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload, correlation_id)
    VALUES (now(), 'agent:enricher', 'link', ${subjectId}, 'enrichment.completed', ${sql.json(payload)}, ${correlationId ?? null})
  `;
}

// ============================================================
// Message Handlers
// ============================================================

function handleTagCatalogMessage(message: EachMessagePayload['message']): void {
  if (!message.value) return;

  try {
    const tags: string[] = JSON.parse(message.value.toString());
    knownTags.clear();
    tags.forEach(t => knownTags.add(t));
    console.log(`[enricher] Tag catalog updated: ${knownTags.size} tags`);
  } catch (err) {
    console.error(`[enricher] Failed to parse tag catalog:`, err);
  }
}

async function handleContentFetchedEvent(event: LifestreamEvent): Promise<void> {
  const { title, text_content, fetch_error } = event.payload as {
    title?: string;
    text_content?: string;
    fetch_error?: string;
  };

  // Skip if fetch had an error
  if (fetch_error) {
    console.log(`[enricher] Skipping ${event.subject_id}: fetch error - ${fetch_error}`);
    return;
  }

  // Skip if no text content
  if (!text_content) {
    console.log(`[enricher] Skipping ${event.subject_id}: no text content`);
    return;
  }

  // Check if already enriched (idempotency)
  if (await alreadyEnriched(event.subject_id)) {
    console.log(`[enricher] Already enriched: ${event.subject_id}`);
    return;
  }

  console.log(`[enricher] Enriching: ${event.subject_id} (${text_content.length} chars, ${knownTags.size} known tags)`);

  try {
    // Call LLM for enrichment with known tags
    const result = await enrichContent(title ?? null, text_content, knownTags);

    // Emit enrichment.completed event
    await emitEnrichmentCompleted(event.subject_id, result, event.id);

    // Update tag catalog with any new tags
    await updateTagCatalog(result.tags);

    console.log(`[enricher] Completed: ${event.subject_id} -> [${result.tags.join(', ')}]`);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`[enricher] Error for ${event.subject_id}: ${err.message}`);
    } else {
      console.error(`[enricher] Error for ${event.subject_id}:`, err);
    }
    // Don't emit an event on error - will retry on next run
  }
}

async function handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
  // Handle tag catalog updates
  if (topic === TAGS_TOPIC) {
    handleTagCatalogMessage(message);
    return;
  }

  // Handle events
  if (!message.value) return;

  const event: LifestreamEvent = JSON.parse(message.value.toString());

  // Only process content.fetched events
  if (event.event_type !== 'content.fetched') {
    return;
  }

  await handleContentFetchedEvent(event);
}

// ============================================================
// Main Consumer Loop
// ============================================================

let consumer: Consumer | null = null;
let isShuttingDown = false;

async function main(): Promise<void> {
  console.log('🧠 Starting Enricher Agent...');
  console.log(`   Consumer Group: ${CONSUMER_GROUP}`);
  console.log(`   Topics: ${EVENTS_TOPIC}, ${TAGS_TOPIC}`);
  console.log(`   Model: ${MODEL}`);
  console.log('   Press Ctrl+C to stop.\n');

  consumer = await createConsumer(CONSUMER_GROUP);

  // Subscribe to both topics
  await consumer.subscribe({ topics: [EVENTS_TOPIC, TAGS_TOPIC], fromBeginning: true });

  await consumer.run({
    eachMessage: handleMessage,
  });
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n🛑 Shutting down Enricher Agent...');

  if (consumer) {
    await consumer.disconnect();
    console.log('   Kafka consumer disconnected');
  }

  await disconnectKafka();
  console.log('   Kafka producer disconnected');

  await closeDb();
  console.log('   Database connection closed');

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err => {
  console.error('Fatal error:', err);
  shutdown();
});
