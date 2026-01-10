/**
 * Router
 *
 * Consumes events from `events.raw` and routes work to dedicated agent topics.
 * This separates "facts" (events) from "tasks" (work messages).
 *
 * Responsibilities:
 * - Idempotency checks (should this work be done?)
 * - Emit work messages to agent-specific topics
 * - Handle retries for failed work
 * - Route exhausted retries to dead letter queue
 *
 * Run with: bun run router
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer, getProducer, disconnectKafka } from '../src/lib/kafka';
import {
  type WorkMessage,
  type WorkType,
  WORK_TOPICS,
  WORK_TYPE_TO_TOPIC,
  createWorkMessage,
  createRetryWorkMessage,
  createDeadLetterMessage,
  shouldRetry,
} from '../src/lib/work_message';
import type { Consumer, EachMessagePayload, Producer } from 'kafkajs';

const CONSUMER_GROUP = 'router-v1';
const EVENTS_TOPIC = 'events.raw';

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

// ============================================================
// Idempotency Checks
// ============================================================

/**
 * Check if content has already been fetched for this subject
 */
async function contentAlreadyFetched(subjectId: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM lifestream.link_content
    WHERE subject_id = ${subjectId}
  `;
  return result.length > 0;
}

/**
 * Check if content has already been enriched for this subject
 */
async function alreadyEnriched(subjectId: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM lifestream.link_metadata
    WHERE subject_id = ${subjectId}
      AND array_length(tags, 1) > 0
  `;
  return result.length > 0;
}

/**
 * Check if link has already been published
 */
async function alreadyPublished(subjectId: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM lifestream.publish_state
    WHERE subject_id = ${subjectId}
      AND published_version >= desired_version
      AND dirty = false
  `;
  return result.length > 0;
}

// ============================================================
// Work Message Production
// ============================================================

let producer: Producer | null = null;

async function getOrCreateProducer(): Promise<Producer> {
  if (!producer) {
    producer = await getProducer();
  }
  return producer;
}

async function emitWorkMessage(workMessage: WorkMessage): Promise<void> {
  const topic = WORK_TYPE_TO_TOPIC[workMessage.work_type];
  const p = await getOrCreateProducer();

  await p.send({
    topic,
    messages: [{
      key: workMessage.subject_id,
      value: JSON.stringify(workMessage),
      headers: {
        work_type: workMessage.work_type,
        attempt: String(workMessage.attempt),
      },
    }],
  });

  console.log(`[router] Emitted ${workMessage.work_type} for ${workMessage.subject_id} (attempt ${workMessage.attempt})`);
}

async function emitToDeadLetter(
  originalWork: WorkMessage,
  finalError: string,
  agent: string
): Promise<void> {
  const dlqMessage = createDeadLetterMessage(originalWork, finalError, agent);
  const p = await getOrCreateProducer();

  await p.send({
    topic: WORK_TOPICS.DEAD_LETTER,
    messages: [{
      key: originalWork.subject_id,
      value: JSON.stringify(dlqMessage),
      headers: {
        work_type: originalWork.work_type,
        agent,
      },
    }],
  });

  console.log(`[router] Dead-lettered ${originalWork.work_type} for ${originalWork.subject_id} after ${originalWork.attempt} attempts`);
}

// ============================================================
// Event Handlers
// ============================================================

async function handleLinkAdded(event: LifestreamEvent): Promise<void> {
  const { url } = event.payload as { url?: string };

  if (!url) {
    console.log(`[router] Skipping link.added: missing URL for ${event.subject_id}`);
    return;
  }

  // Idempotency check
  if (await contentAlreadyFetched(event.subject_id)) {
    console.log(`[router] Skipping link.added: already fetched ${event.subject_id}`);
    return;
  }

  const workMessage = createWorkMessage(
    'fetch_link',
    event.subject_id,
    event.id,
    event.correlation_id ?? event.id,
    { url }
  );

  await emitWorkMessage(workMessage);
}

async function handleContentFetched(event: LifestreamEvent): Promise<void> {
  const { title, text_content, fetch_error } = event.payload as {
    title?: string;
    text_content?: string;
    fetch_error?: string;
  };

  // Skip if fetch had an error
  if (fetch_error) {
    console.log(`[router] Skipping content.fetched: fetch error for ${event.subject_id}`);
    return;
  }

  // Skip if no text content
  if (!text_content) {
    console.log(`[router] Skipping content.fetched: no text content for ${event.subject_id}`);
    return;
  }

  // Idempotency check
  if (await alreadyEnriched(event.subject_id)) {
    console.log(`[router] Skipping content.fetched: already enriched ${event.subject_id}`);
    return;
  }

  const workMessage = createWorkMessage(
    'enrich_link',
    event.subject_id,
    event.id,
    event.correlation_id ?? event.id,
    { title, text_content }
  );

  await emitWorkMessage(workMessage);
}

async function handleEnrichmentCompleted(event: LifestreamEvent): Promise<void> {
  // Idempotency check
  if (await alreadyPublished(event.subject_id)) {
    console.log(`[router] Skipping enrichment.completed: already published ${event.subject_id}`);
    return;
  }

  const workMessage = createWorkMessage(
    'publish_link',
    event.subject_id,
    event.id,
    event.correlation_id ?? event.id,
    {}
  );

  await emitWorkMessage(workMessage);
}

async function handleWorkFailed(event: LifestreamEvent): Promise<void> {
  const { work_message, error, agent } = event.payload as {
    work_message: WorkMessage;
    error: string;
    agent: string;
  };

  if (!work_message) {
    console.error(`[router] work.failed event missing work_message payload`);
    return;
  }

  // Check if we should retry
  if (shouldRetry(work_message)) {
    const retryWork = createRetryWorkMessage(work_message, error);
    await emitWorkMessage(retryWork);
  } else {
    // Max retries exceeded - send to dead letter queue
    await emitToDeadLetter(work_message, error, agent);
  }
}

// ============================================================
// Event Router
// ============================================================

async function processEvent(event: LifestreamEvent): Promise<void> {
  switch (event.event_type) {
    case 'link.added':
      await handleLinkAdded(event);
      break;
    case 'content.fetched':
      await handleContentFetched(event);
      break;
    case 'enrichment.completed':
      await handleEnrichmentCompleted(event);
      break;
    case 'work.failed':
      await handleWorkFailed(event);
      break;
    default:
      // Ignore other event types (they're handled by materializer, not router)
      break;
  }
}

// ============================================================
// Message Handler
// ============================================================

async function handleMessage({ message }: EachMessagePayload): Promise<void> {
  if (!message.value) {
    return;
  }

  try {
    const event: LifestreamEvent = JSON.parse(message.value.toString());
    await processEvent(event);
  } catch (err) {
    console.error(`[router] Error processing message:`, err);
    // Continue processing - don't block on individual message errors
  }
}

// ============================================================
// Main Consumer Loop
// ============================================================

let consumer: Consumer | null = null;
let isShuttingDown = false;

async function main(): Promise<void> {
  console.log('🔀 Starting Router...');
  console.log(`   Consumer Group: ${CONSUMER_GROUP}`);
  console.log(`   Input Topic: ${EVENTS_TOPIC}`);
  console.log(`   Output Topics: ${Object.values(WORK_TOPICS).join(', ')}`);
  console.log('   Press Ctrl+C to stop.\n');

  consumer = await createConsumer(CONSUMER_GROUP);

  await consumer.subscribe({ topic: EVENTS_TOPIC, fromBeginning: true });

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

  console.log('\n🛑 Shutting down Router...');

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
