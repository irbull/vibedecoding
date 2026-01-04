/**
 * Kafka → DB Materializer
 *
 * Consumes events from the `events.raw` Kafka topic and materializes them
 * into Postgres state tables.
 *
 * OFFSET TRACKING: DB is the sole source of truth.
 * - event_ingest_dedupe table tracks which Kafka offsets have been processed
 * - We do NOT commit offsets to Kafka consumer groups
 * - On startup, we seek to where DB says we left off
 * - This ensures crash recovery works correctly with no dual-state issues
 *
 * Run with: bun run scripts/consume_kafka_materialize.ts
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer, getKafka } from '../src/lib/kafka';
import { normalizeUrl } from '../src/lib/subject_id';
import type { Consumer, EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'materializer-v1';
const TOPIC = 'events.raw';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

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
// Idempotency Layer
// ============================================================

async function isAlreadyProcessed(topic: string, partition: number, offset: bigint): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM lifestream.event_ingest_dedupe
    WHERE topic = ${topic}
      AND partition = ${partition}
      AND kafka_offset = ${offset}
  `;
  return result.length > 0;
}

async function recordProcessed(topic: string, partition: number, offset: bigint): Promise<void> {
  await sql`
    INSERT INTO lifestream.event_ingest_dedupe (topic, partition, kafka_offset)
    VALUES (${topic}, ${partition}, ${offset})
    ON CONFLICT DO NOTHING
  `;

  await sql`
    INSERT INTO lifestream.kafka_offsets (consumer_group, topic, partition, last_offset)
    VALUES (${CONSUMER_GROUP}, ${topic}, ${partition}, ${offset})
    ON CONFLICT (consumer_group, topic, partition)
    DO UPDATE SET last_offset = EXCLUDED.last_offset, updated_at = now()
  `;
}

// ============================================================
// Domain Handlers
// ============================================================

async function handleLinkAdded(event: LifestreamEvent): Promise<void> {
  const { url, url_norm } = event.payload as { url?: string; url_norm?: string };

  if (!url) {
    console.log(`  [link.added] WARNING: Missing url in payload, skipping: ${event.subject_id}`);
    return;
  }

  // Compute url_norm if not provided
  const normalizedUrl = url_norm ?? normalizeUrl(url);

  // Upsert subject
  await sql`
    INSERT INTO lifestream.subjects (subject, subject_id, created_at, visibility, meta)
    VALUES ('link', ${event.subject_id}, ${event.occurred_at}, 'public', '{}')
    ON CONFLICT (subject, subject_id) DO NOTHING
  `;

  // Upsert link
  await sql`
    INSERT INTO lifestream.links (subject_id, url, url_norm, created_at, source, status, visibility, pinned)
    VALUES (${event.subject_id}, ${url}, ${normalizedUrl}, ${event.occurred_at}, ${event.source}, 'new', 'public', false)
    ON CONFLICT (subject_id) DO NOTHING
  `;

  console.log(`  [link.added] Created link: ${event.subject_id}`);
}

async function handleContentFetched(event: LifestreamEvent): Promise<void> {
  const { final_url, title, text_content, html_storage_key, fetch_error } = event.payload as {
    final_url?: string;
    title?: string;
    text_content?: string;
    html_storage_key?: string;
    fetch_error?: string;
  };

  // Upsert link_content
  await sql`
    INSERT INTO lifestream.link_content (subject_id, final_url, title, text_content, html_storage_key, fetched_at, fetch_error)
    VALUES (${event.subject_id}, ${final_url ?? null}, ${title ?? null}, ${text_content ?? null}, ${html_storage_key ?? null}, ${event.occurred_at}, ${fetch_error ?? null})
    ON CONFLICT (subject_id) DO UPDATE SET
      final_url = COALESCE(EXCLUDED.final_url, lifestream.link_content.final_url),
      title = COALESCE(EXCLUDED.title, lifestream.link_content.title),
      text_content = COALESCE(EXCLUDED.text_content, lifestream.link_content.text_content),
      html_storage_key = COALESCE(EXCLUDED.html_storage_key, lifestream.link_content.html_storage_key),
      fetched_at = EXCLUDED.fetched_at,
      fetch_error = EXCLUDED.fetch_error
  `;

  // Update link status (and retry tracking on error)
  if (fetch_error) {
    await sql`
      UPDATE lifestream.links
      SET status = 'error',
          retry_count = retry_count + 1,
          last_error_at = now(),
          last_error = ${fetch_error}
      WHERE subject_id = ${event.subject_id}
    `;
    console.log(`  [content.fetched] Error: ${event.subject_id} -> error (retry_count incremented)`);
  } else {
    await sql`
      UPDATE lifestream.links
      SET status = 'fetched',
          last_error = null
      WHERE subject_id = ${event.subject_id} AND status = 'new'
    `;
    console.log(`  [content.fetched] Updated: ${event.subject_id} -> fetched`);
  }
}

async function handleEnrichmentCompleted(event: LifestreamEvent): Promise<void> {
  const { tags, summary_short, summary_long, summary, language, model_version } = event.payload as {
    tags?: string[];
    summary_short?: string;
    summary_long?: string;
    summary?: string; // Backwards compat with seed data
    language?: string;
    model_version?: string;
  };

  // Use summary as summary_short if summary_short not provided
  const shortSummary = summary_short ?? summary ?? null;

  // Upsert link_metadata (tags has NOT NULL DEFAULT '{}')
  // Use CASE to prefer non-empty arrays over empty ones
  await sql`
    INSERT INTO lifestream.link_metadata (subject_id, tags, summary_short, summary_long, language, model_version)
    VALUES (${event.subject_id}, ${tags ?? []}, ${shortSummary}, ${summary_long ?? null}, ${language ?? null}, ${model_version ?? null})
    ON CONFLICT (subject_id) DO UPDATE SET
      tags = CASE
        WHEN array_length(EXCLUDED.tags, 1) > 0 THEN EXCLUDED.tags
        ELSE COALESCE(NULLIF(lifestream.link_metadata.tags, '{}'), EXCLUDED.tags)
      END,
      summary_short = COALESCE(EXCLUDED.summary_short, lifestream.link_metadata.summary_short),
      summary_long = COALESCE(EXCLUDED.summary_long, lifestream.link_metadata.summary_long),
      language = COALESCE(EXCLUDED.language, lifestream.link_metadata.language),
      model_version = COALESCE(EXCLUDED.model_version, lifestream.link_metadata.model_version)
  `;

  // Update link status
  await sql`
    UPDATE lifestream.links
    SET status = 'enriched'
    WHERE subject_id = ${event.subject_id} AND status IN ('new', 'fetched')
  `;

  // Bump publish_state desired_version
  await sql`
    INSERT INTO lifestream.publish_state (subject_id, desired_version, published_version, dirty)
    VALUES (${event.subject_id}, 1, 0, true)
    ON CONFLICT (subject_id) DO UPDATE SET
      desired_version = lifestream.publish_state.desired_version + 1,
      dirty = true
  `;

  console.log(`  [enrichment.completed] Updated: ${event.subject_id}`);
}

async function handlePublishCompleted(event: LifestreamEvent): Promise<void> {
  // Update publish_state
  await sql`
    UPDATE lifestream.publish_state
    SET published_version = desired_version,
        dirty = false,
        last_published_at = ${event.occurred_at}
    WHERE subject_id = ${event.subject_id}
  `;

  // Update link status
  await sql`
    UPDATE lifestream.links
    SET status = 'published'
    WHERE subject_id = ${event.subject_id}
  `;

  console.log(`  [publish.completed] Published: ${event.subject_id}`);
}

async function handleTempReading(event: LifestreamEvent): Promise<void> {
  const { celsius, humidity, battery } = event.payload as {
    celsius?: number;
    humidity?: number;
    battery?: number;
  };

  if (celsius === undefined) {
    console.log(`  [temp.reading] WARNING: Missing celsius in payload, skipping: ${event.subject_id}`);
    return;
  }

  // Upsert subject (if not exists)
  await sql`
    INSERT INTO lifestream.subjects (subject, subject_id, created_at, visibility, meta)
    VALUES ('sensor', ${event.subject_id}, ${event.occurred_at}, 'private', ${JSON.stringify({ type: 'temperature' })})
    ON CONFLICT (subject, subject_id) DO NOTHING
  `;

  // Insert reading (time-series)
  await sql`
    INSERT INTO lifestream.temperature_readings (subject_id, occurred_at, celsius, humidity, battery)
    VALUES (${event.subject_id}, ${event.occurred_at}, ${celsius}, ${humidity ?? null}, ${battery ?? null})
    ON CONFLICT (subject_id, occurred_at) DO NOTHING
  `;

  // Upsert latest (only if newer)
  await sql`
    INSERT INTO lifestream.temperature_latest (subject_id, occurred_at, celsius, humidity, battery)
    VALUES (${event.subject_id}, ${event.occurred_at}, ${celsius}, ${humidity ?? null}, ${battery ?? null})
    ON CONFLICT (subject_id) DO UPDATE SET
      occurred_at = EXCLUDED.occurred_at,
      celsius = EXCLUDED.celsius,
      humidity = EXCLUDED.humidity,
      battery = EXCLUDED.battery
    WHERE lifestream.temperature_latest.occurred_at < EXCLUDED.occurred_at
  `;

  console.log(`  [temp.reading] ${event.subject_id}: ${celsius}°C`);
}

async function handleTodoCreated(event: LifestreamEvent): Promise<void> {
  const { title, project, labels, due_at } = event.payload as {
    title?: string;
    project?: string;
    labels?: string[];
    due_at?: string;
  };

  if (!title) {
    console.log(`  [todo.created] WARNING: Missing title in payload, skipping: ${event.subject_id}`);
    return;
  }

  // Upsert subject
  await sql`
    INSERT INTO lifestream.subjects (subject, subject_id, created_at, display_name, visibility, meta)
    VALUES ('todo', ${event.subject_id}, ${event.occurred_at}, ${title}, 'private', ${JSON.stringify({ source: event.source })})
    ON CONFLICT (subject, subject_id) DO UPDATE SET display_name = EXCLUDED.display_name
  `;

  // Upsert todo (labels has NOT NULL DEFAULT '{}')
  await sql`
    INSERT INTO lifestream.todos (subject_id, title, project, labels, status, due_at, meta)
    VALUES (${event.subject_id}, ${title}, ${project ?? null}, ${labels ?? []}, 'open', ${due_at ?? null}, ${JSON.stringify({ source: event.source })})
    ON CONFLICT (subject_id) DO UPDATE SET
      title = EXCLUDED.title,
      project = COALESCE(EXCLUDED.project, lifestream.todos.project),
      labels = COALESCE(EXCLUDED.labels, lifestream.todos.labels),
      due_at = COALESCE(EXCLUDED.due_at, lifestream.todos.due_at)
  `;

  console.log(`  [todo.created] ${event.subject_id}: ${title}`);
}

async function handleTodoCompleted(event: LifestreamEvent): Promise<void> {
  await sql`
    UPDATE lifestream.todos
    SET status = 'done',
        completed_at = ${event.occurred_at}
    WHERE subject_id = ${event.subject_id}
  `;

  console.log(`  [todo.completed] ${event.subject_id}`);
}

async function handleAnnotationAdded(event: LifestreamEvent): Promise<void> {
  const { annotation_id, link_subject_id, quote, note, selector, visibility } = event.payload as {
    annotation_id: string;
    link_subject_id: string;
    quote?: string;
    note?: string;
    selector?: Record<string, unknown>;
    visibility?: string;
  };

  // Upsert subject for annotation
  await sql`
    INSERT INTO lifestream.subjects (subject, subject_id, created_at, visibility, meta)
    VALUES ('annotation', ${event.subject_id}, ${event.occurred_at}, ${visibility ?? 'private'}, '{}')
    ON CONFLICT (subject, subject_id) DO NOTHING
  `;

  // Upsert annotation
  await sql`
    INSERT INTO lifestream.annotations (annotation_id, subject_id, link_subject_id, created_at, quote, note, selector, visibility)
    VALUES (${annotation_id}::uuid, ${event.subject_id}, ${link_subject_id}, ${event.occurred_at}, ${quote ?? null}, ${note ?? null}, ${JSON.stringify(selector ?? {})}, ${visibility ?? 'private'})
    ON CONFLICT (annotation_id) DO UPDATE SET
      quote = COALESCE(EXCLUDED.quote, lifestream.annotations.quote),
      note = COALESCE(EXCLUDED.note, lifestream.annotations.note),
      selector = EXCLUDED.selector,
      updated_at = now()
  `;

  console.log(`  [annotation.added] ${event.subject_id} -> ${link_subject_id}`);
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
    case 'publish.completed':
      await handlePublishCompleted(event);
      break;
    case 'temp.reading_recorded':
      await handleTempReading(event);
      break;
    case 'todo.created':
      await handleTodoCreated(event);
      break;
    case 'todo.completed':
      await handleTodoCompleted(event);
      break;
    case 'annotation.added':
      await handleAnnotationAdded(event);
      break;
    default:
      console.log(`  [unknown] Skipping unhandled event type: ${event.event_type}`);
  }
}

// ============================================================
// Startup Offset Sync
// ============================================================

/**
 * Calculate the target offset based on DB state and Kafka's available range.
 * Returns the offset we should start consuming from.
 */
async function calculateTargetOffset(): Promise<bigint> {
  const kafka = getKafka();
  const admin = kafka.admin();
  await admin.connect();

  try {
    // 1. Get our last processed offset from DB
    const result = await sql`
      SELECT MAX(kafka_offset) as last_offset
      FROM lifestream.event_ingest_dedupe
      WHERE topic = ${TOPIC} AND partition = 0
    `;
    const lastProcessedOffset = result[0]?.last_offset;
    const desiredOffset = lastProcessedOffset !== null
      ? BigInt(lastProcessedOffset) + 1n
      : 0n;

    // 2. Get Kafka's valid offset range for this partition
    const offsets = await admin.fetchTopicOffsets(TOPIC);
    const partitionInfo = offsets.find(p => p.partition === 0);
    const earliestOffset = BigInt(partitionInfo?.low ?? '0');
    const latestOffset = BigInt(partitionInfo?.high ?? '0');

    console.log(`[materializer] DB last processed: ${lastProcessedOffset ?? 'none'}`);
    console.log(`[materializer] Kafka range: [${earliestOffset}, ${latestOffset})`);

    // 3. Clamp to valid range
    let targetOffset = desiredOffset;
    if (desiredOffset < earliestOffset) {
      // Our desired offset was deleted by retention, start from earliest available
      console.log(`[materializer] Desired offset ${desiredOffset} < earliest ${earliestOffset}, using earliest`);
      targetOffset = earliestOffset;
    } else if (desiredOffset > latestOffset) {
      // Kafka was reset/recreated - our DB has stale offsets from the old Kafka
      // Clear stale dedupe records so we can reprocess with new offsets
      console.log(`[materializer] Desired offset ${desiredOffset} > latest ${latestOffset} - Kafka was reset`);
      console.log(`[materializer] Clearing stale dedupe records for topic ${TOPIC}...`);

      await sql`
        DELETE FROM lifestream.event_ingest_dedupe
        WHERE topic = ${TOPIC}
      `;

      console.log(`[materializer] Starting from earliest offset (${earliestOffset})`);
      targetOffset = earliestOffset;
    }

    console.log(`[materializer] Will start from offset: ${targetOffset}`);
    return targetOffset;

  } finally {
    await admin.disconnect();
  }
}

// ============================================================
// Main Consumer Loop
// ============================================================

let consumer: Consumer | null = null;
let isShuttingDown = false;

async function handleMessage({ topic, partition, message }: EachMessagePayload): Promise<void> {
  const offset = BigInt(message.offset);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Check idempotency
      if (await isAlreadyProcessed(topic, partition, offset)) {
        console.log(`Skipping duplicate: ${topic}:${partition}:${offset}`);
        return;
      }

      // Parse event
      if (!message.value) {
        console.log(`Empty message at ${topic}:${partition}:${offset}`);
        await recordProcessed(topic, partition, offset);
        return;
      }

      const event: LifestreamEvent = JSON.parse(message.value.toString());
      console.log(`Processing: ${event.event_type} (${event.subject_id})`);

      // Process event
      await processEvent(event);

      // Record as processed
      await recordProcessed(topic, partition, offset);
      return; // Success

    } catch (err) {
      console.error(`[materializer] Error processing ${topic}:${partition}:${offset} (attempt ${attempt}/${MAX_RETRIES}):`, err);

      if (attempt === MAX_RETRIES) {
        console.error(`[materializer] Max retries exceeded for offset ${offset}. Recording as processed to avoid blocking.`);
        // Record as processed to avoid infinite loop on poison messages
        try {
          await recordProcessed(topic, partition, offset);
        } catch (recordErr) {
          console.error(`[materializer] Failed to record offset:`, recordErr);
        }
        return;
      }

      // Exponential backoff
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[materializer] Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting Kafka → DB Materializer...');
  console.log(`   Consumer Group: ${CONSUMER_GROUP}`);
  console.log(`   Topic: ${TOPIC}`);
  console.log('   Press Ctrl+C to stop.\n');

  // Calculate target offset based on DB state and Kafka's available range
  const targetOffset = await calculateTargetOffset();
  let hasSeekPerformed = false;

  while (!isShuttingDown) {
    try {
      consumer = await createConsumer(CONSUMER_GROUP);

      await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

      // DB is the sole source of truth for offset tracking.
      // We don't commit offsets to Kafka - instead we:
      // 1. Seek to where DB says we left off
      // 2. Process messages and record to DB
      // 3. On restart, DB tells us where to resume
      await consumer.run({
        autoCommit: false,
        eachMessage: async (payload) => {
          // Seek to our calculated target offset on first message
          // This handles Kafka reset scenarios where our DB offset is stale
          if (!hasSeekPerformed) {
            const currentOffset = BigInt(payload.message.offset);
            if (currentOffset !== targetOffset) {
              console.log(`[materializer] Seeking from ${currentOffset} to ${targetOffset}`);
              consumer!.seek({ topic: TOPIC, partition: payload.partition, offset: targetOffset.toString() });
              hasSeekPerformed = true;
              return; // Skip this message, we'll get the right one after seek
            }
            hasSeekPerformed = true;
          }

          await handleMessage(payload);
          // NO commitOffsets() - DB is the sole source of truth
          // The offset is recorded in event_ingest_dedupe by handleMessage()
        }
      });

      // consumer.run() returns a promise that resolves when consumer stops
      // If we get here without error, break the loop
      break;

    } catch (err) {
      console.error('[materializer] Consumer error:', err);

      if (isShuttingDown) break;

      // Disconnect and retry
      if (consumer) {
        try {
          await consumer.disconnect();
        } catch (disconnectErr) {
          console.error('[materializer] Error disconnecting:', disconnectErr);
        }
        consumer = null;
      }

      console.log('[materializer] Reconnecting in 5s...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n🛑 Shutting down...');

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
