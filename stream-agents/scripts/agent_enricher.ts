/**
 * Enricher Agent
 *
 * Consumes `content.fetched` events from Kafka, calls OpenAI to generate
 * tags and summaries, and emits `enrichment.completed` events to Postgres.
 *
 * Uses Fat Events pattern - reads text_content directly from event payload.
 *
 * Run with: bun run agent:enricher
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer } from '../src/lib/kafka';
import OpenAI from 'openai';
import type { Consumer, EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'enricher-agent-v1';
const TOPIC = 'events.raw';
const MODEL = 'gpt-4o-mini';
const MAX_CONTENT_CHARS = 32000; // ~8K tokens for cost control

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
  textContent: string
): Promise<EnrichmentResult> {
  // Truncate content for cost control
  const truncated = textContent.slice(0, MAX_CONTENT_CHARS);

  const prompt = `Analyze this article and provide:
1. 3-7 relevant tags (lowercase, hyphenated, e.g., "machine-learning", "web-development")
2. A short summary (1-2 sentences, max 200 characters)
3. A longer summary (2-3 paragraphs)
4. The primary language (ISO 639-1 code, e.g., "en", "es", "fr")

${title ? `Title: ${title}\n\n` : ''}Content:
${truncated}

Respond ONLY with valid JSON in this exact format:
{
  "tags": ["tag1", "tag2"],
  "summary_short": "...",
  "summary_long": "...",
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
// Message Handler
// ============================================================

async function handleMessage({ topic, partition, message }: EachMessagePayload): Promise<void> {
  if (!message.value) {
    return;
  }

  const event: LifestreamEvent = JSON.parse(message.value.toString());

  // Only process content.fetched events
  if (event.event_type !== 'content.fetched') {
    return;
  }

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

  console.log(`[enricher] Enriching: ${event.subject_id} (${text_content.length} chars)`);

  try {
    // Call LLM for enrichment
    const result = await enrichContent(title ?? null, text_content);

    // Emit enrichment.completed event
    await emitEnrichmentCompleted(event.subject_id, result, event.id);

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

// ============================================================
// Main Consumer Loop
// ============================================================

let consumer: Consumer | null = null;
let isShuttingDown = false;

async function main(): Promise<void> {
  console.log('🧠 Starting Enricher Agent...');
  console.log(`   Consumer Group: ${CONSUMER_GROUP}`);
  console.log(`   Topic: ${TOPIC}`);
  console.log(`   Model: ${MODEL}`);
  console.log('   Press Ctrl+C to stop.\n');

  consumer = await createConsumer(CONSUMER_GROUP);

  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

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
