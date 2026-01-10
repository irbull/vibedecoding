/**
 * Enricher Agent
 *
 * Consumes work messages from `work.enrich_link`, calls OpenAI to generate
 * tags and summaries, and emits `enrichment.completed` events to Postgres.
 *
 * Uses Kafka-native KTable pattern for tag alignment:
 * - Consumes `tags.catalog` compacted topic to maintain known tags
 * - Passes known tags to LLM for consistency
 * - Emits new tags back to `tags.catalog`
 *
 * On failure, emits `work.failed` event for retry handling by the router.
 *
 * Run with: bun run agent:enricher
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer, getProducer, disconnectKafka } from '../src/lib/kafka';
import { WORK_TOPICS, type WorkMessage } from '../src/lib/work_message';
import OpenAI from 'openai';
import type { Consumer, EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'enricher-agent-v2';
const WORK_TOPIC = WORK_TOPICS.ENRICH_LINK;
const TAGS_TOPIC = 'tags.catalog';
const AGENT_NAME = 'enricher';
const MODEL = 'gpt-4o-mini';
const MAX_CONTENT_CHARS = 32000; // ~8K tokens for cost control
const MAX_TAGS_IN_PROMPT = 100; // Limit tags in prompt to control size

// ============================================================
// Types
// ============================================================

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
  correlationId: string
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
    VALUES (now(), 'agent:enricher', 'link', ${subjectId}, 'enrichment.completed', ${sql.json(payload)}, ${correlationId})
  `;
}

async function emitWorkFailed(
  workMessage: WorkMessage,
  error: string
): Promise<void> {
  const payload = {
    work_message: workMessage,
    error,
    agent: AGENT_NAME,
  };

  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload, correlation_id)
    VALUES (now(), 'agent:enricher', 'link', ${workMessage.subject_id}, 'work.failed', ${sql.json(payload)}, ${workMessage.correlation_id})
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

async function handleWorkMessage(workMessage: WorkMessage): Promise<void> {
  const { title, text_content } = workMessage.payload as {
    title?: string;
    text_content?: string;
  };

  if (!text_content) {
    console.log(`[enricher] Skipping ${workMessage.subject_id}: no text content in work message`);
    return;
  }

  console.log(`[enricher] Enriching: ${workMessage.subject_id} (${text_content.length} chars, ${knownTags.size} known tags, attempt ${workMessage.attempt}/${workMessage.max_attempts})`);

  try {
    // Call LLM for enrichment with known tags
    const result = await enrichContent(title ?? null, text_content, knownTags);

    // Emit enrichment.completed event
    await emitEnrichmentCompleted(workMessage.subject_id, result, workMessage.correlation_id);

    // Update tag catalog with any new tags
    await updateTagCatalog(result.tags);

    console.log(`[enricher] Completed: ${workMessage.subject_id} -> [${result.tags.join(', ')}]`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[enricher] Error for ${workMessage.subject_id}: ${errorMessage}`);

    // Emit work.failed for router to handle retry
    await emitWorkFailed(workMessage, errorMessage);
  }
}

async function handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
  // Handle tag catalog updates
  if (topic === TAGS_TOPIC) {
    handleTagCatalogMessage(message);
    return;
  }

  // Handle work messages
  if (!message.value) return;

  const workMessage: WorkMessage = JSON.parse(message.value.toString());
  await handleWorkMessage(workMessage);
}

// ============================================================
// Main Consumer Loop
// ============================================================

let consumer: Consumer | null = null;
let isShuttingDown = false;

async function main(): Promise<void> {
  console.log('🧠 Starting Enricher Agent...');
  console.log(`   Consumer Group: ${CONSUMER_GROUP}`);
  console.log(`   Topics: ${WORK_TOPIC}, ${TAGS_TOPIC}`);
  console.log(`   Model: ${MODEL}`);
  console.log('   Press Ctrl+C to stop.\n');

  consumer = await createConsumer(CONSUMER_GROUP);

  // Subscribe to both topics
  await consumer.subscribe({ topics: [WORK_TOPIC, TAGS_TOPIC], fromBeginning: true });

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
