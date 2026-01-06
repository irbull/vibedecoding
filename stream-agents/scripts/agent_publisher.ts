/**
 * Publisher Agent
 *
 * Consumes `enrichment.completed` events from Kafka and emits
 * `publish.completed` events to Postgres.
 *
 * This agent marks links as ready for publishing. The materializer
 * then updates `publish_state` and `links.status` to 'published'.
 *
 * Run with: bun run agent:publisher
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer } from '../src/lib/kafka';
import type { Consumer, EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'publisher-agent-v1';
const TOPIC = 'events.raw';

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
// Idempotency
// ============================================================

async function alreadyPublished(subjectId: string): Promise<boolean> {
  // Check if publish_state exists and published_version >= desired_version
  const result = await sql`
    SELECT 1 FROM lifestream.publish_state
    WHERE subject_id = ${subjectId}
      AND published_version >= desired_version
      AND dirty = false
  `;
  return result.length > 0;
}

// ============================================================
// Event Emission
// ============================================================

async function emitPublishCompleted(
  subjectId: string,
  correlationId?: string
): Promise<void> {
  const payload = {
    published_at: new Date().toISOString(),
  };

  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload, correlation_id)
    VALUES (now(), 'agent:publisher', 'link', ${subjectId}, 'publish.completed', ${sql.json(payload)}, ${correlationId ?? null})
  `;
}

// ============================================================
// Message Handler
// ============================================================

async function handleMessage({ message }: EachMessagePayload): Promise<void> {
  if (!message.value) {
    return;
  }

  const event: LifestreamEvent = JSON.parse(message.value.toString());

  // Only process enrichment.completed events
  if (event.event_type !== 'enrichment.completed') {
    return;
  }

  // Check if already published (idempotency)
  if (await alreadyPublished(event.subject_id)) {
    console.log(`[publisher] Already published: ${event.subject_id}`);
    return;
  }

  console.log(`[publisher] Publishing: ${event.subject_id}`);

  try {
    // Emit publish.completed event
    await emitPublishCompleted(event.subject_id, event.id);
    console.log(`[publisher] Completed: ${event.subject_id}`);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`[publisher] Error for ${event.subject_id}: ${err.message}`);
    } else {
      console.error(`[publisher] Error for ${event.subject_id}:`, err);
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
  console.log('📤 Starting Publisher Agent...');
  console.log(`   Consumer Group: ${CONSUMER_GROUP}`);
  console.log(`   Topic: ${TOPIC}`);
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

  console.log('\n🛑 Shutting down Publisher Agent...');

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
