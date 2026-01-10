/**
 * Publisher Agent
 *
 * Consumes work messages from `work.publish_link` and emits
 * `publish.completed` events to Postgres.
 *
 * This agent marks links as ready for publishing. The materializer
 * then updates `publish_state` and `links.status` to 'published'.
 *
 * On failure, emits `work.failed` event for retry handling by the router.
 *
 * Run with: bun run agent:publisher
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer } from '../src/lib/kafka';
import { WORK_TOPICS, type WorkMessage } from '../src/lib/work_message';
import type { Consumer, EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'publisher-agent-v2';
const TOPIC = WORK_TOPICS.PUBLISH_LINK;
const AGENT_NAME = 'publisher';

// ============================================================
// Event Emission
// ============================================================

async function emitPublishCompleted(
  subjectId: string,
  correlationId: string
): Promise<void> {
  const payload = {
    published_at: new Date().toISOString(),
  };

  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload, correlation_id)
    VALUES (now(), 'agent:publisher', 'link', ${subjectId}, 'publish.completed', ${sql.json(payload)}, ${correlationId})
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
    VALUES (now(), 'agent:publisher', 'link', ${workMessage.subject_id}, 'work.failed', ${sql.json(payload)}, ${workMessage.correlation_id})
  `;
}

// ============================================================
// Message Handler
// ============================================================

async function handleMessage({ message }: EachMessagePayload): Promise<void> {
  if (!message.value) {
    return;
  }

  const workMessage: WorkMessage = JSON.parse(message.value.toString());

  console.log(`[publisher] Publishing: ${workMessage.subject_id} (attempt ${workMessage.attempt}/${workMessage.max_attempts})`);

  try {
    // Emit publish.completed event
    await emitPublishCompleted(workMessage.subject_id, workMessage.correlation_id);
    console.log(`[publisher] Completed: ${workMessage.subject_id}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[publisher] Error for ${workMessage.subject_id}: ${errorMessage}`);

    // Emit work.failed for router to handle retry
    await emitWorkFailed(workMessage, errorMessage);
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
