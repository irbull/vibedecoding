/**
 * Debug script to check pipeline state for a specific link
 */
import { sql, closeDb } from '../src/lib/db';

const subjectId = process.argv[2] || 'link:a22bfc74473b06ac';

async function debug() {
  console.log(`\n=== Debugging ${subjectId} ===\n`);

  // Check the link status
  const link = await sql`
    SELECT subject_id, url, status, retry_count, last_error_at, last_error, created_at
    FROM lifestream.links
    WHERE subject_id = ${subjectId}
  `;
  console.log('Link:', link[0] || 'NOT FOUND');

  // Check recent events for this link
  const events = await sql`
    SELECT id, event_type, source, occurred_at, received_at
    FROM lifestream.events
    WHERE subject_id = ${subjectId}
    ORDER BY received_at DESC
    LIMIT 10
  `;
  console.log('\nRecent events:');
  if (events.length === 0) {
    console.log('  (none)');
  } else {
    events.forEach(e => console.log(`  ${e.event_type} from ${e.source} at ${e.received_at}`));
  }

  // Check if link_content exists
  const content = await sql`
    SELECT subject_id, title, fetch_error, fetched_at FROM lifestream.link_content
    WHERE subject_id = ${subjectId}
  `;
  console.log('\nLink content:', content.length > 0 ? content[0] : '(none)');

  // Check unpublished events count
  const unpublished = await sql`
    SELECT COUNT(*) as count FROM lifestream.events
    WHERE published_to_kafka = false
  `;
  console.log('\nUnpublished events:', unpublished[0].count);

  // Check materializer dedupe state
  const dedupe = await sql`
    SELECT topic, partition, kafka_offset, inserted_at
    FROM lifestream.event_ingest_dedupe
    ORDER BY kafka_offset DESC
    LIMIT 5
  `;
  console.log('\nMaterializer dedupe (last 5 offsets):');
  if (dedupe.length === 0) {
    console.log('  (none)');
  } else {
    dedupe.forEach(d => console.log(`  offset ${d.kafka_offset} at ${d.inserted_at}`));
  }

  // Check kafka_offsets table
  const kafkaOffsets = await sql`
    SELECT * FROM lifestream.kafka_offsets
  `;
  console.log('\nKafka offsets table:', kafkaOffsets.length > 0 ? kafkaOffsets : '(none)');

  // Check all recent events (to understand offset mapping)
  const allEvents = await sql`
    SELECT id, event_type, source, subject_id, received_at
    FROM lifestream.events
    ORDER BY received_at DESC
    LIMIT 10
  `;
  console.log('\nAll recent events in Postgres:');
  allEvents.forEach((e, i) => console.log(`  ${e.event_type} (${e.subject_id.slice(0, 20)}...) from ${e.source} at ${e.received_at}`));

  await closeDb();
}

debug().catch(err => {
  console.error('Error:', err);
  closeDb().then(() => process.exit(1));
});
