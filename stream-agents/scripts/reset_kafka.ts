/**
 * Reset Kafka Topic
 *
 * Deletes and recreates the events.raw topic to clear all messages.
 * Also resets event publication status and Kafka offset tracking tables.
 *
 * Run with: bun run scripts/reset_kafka.ts
 */

import { getKafka, disconnectKafka } from '../src/lib/kafka';
import { sql, closeDb } from '../src/lib/db';

const TOPIC = 'events.raw';
const NUM_PARTITIONS = 3;
const REPLICATION_FACTOR = 1;

async function main() {
  const kafka = getKafka();
  const admin = kafka.admin();

  console.log('🗑️  Resetting Kafka topic and consumer state...\n');

  // 1. Connect to Kafka Admin
  console.log('Connecting to Kafka Admin...');
  await admin.connect();
  console.log('Connected.\n');

  // 2. Delete the topic if it exists
  const existingTopics = await admin.listTopics();
  if (existingTopics.includes(TOPIC)) {
    console.log(`Deleting topic '${TOPIC}'...`);
    await admin.deleteTopics({ topics: [TOPIC] });
    console.log(`Topic '${TOPIC}' deleted.`);

    // Wait for deletion to propagate
    console.log('Waiting for deletion to propagate...');
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log(`Topic '${TOPIC}' does not exist.`);
  }

  // 3. Recreate the topic
  console.log(`\nCreating topic '${TOPIC}'...`);
  await admin.createTopics({
    topics: [{
      topic: TOPIC,
      numPartitions: NUM_PARTITIONS,
      replicationFactor: REPLICATION_FACTOR,
      configEntries: [
        { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) } // 7 days
      ]
    }]
  });
  console.log(`Topic '${TOPIC}' created with ${NUM_PARTITIONS} partitions.\n`);

  await admin.disconnect();

  // 4. Reset event publication status (mark all events as unpublished for replay)
  console.log('Resetting event publication status...');
  const eventResult = await sql`UPDATE lifestream.events SET published_to_kafka = false`;
  console.log(`  Reset published_to_kafka: ${eventResult.count} events marked as unpublished.`);

  // 5. Clear Kafka offset tracking tables in DB
  console.log('\nClearing Kafka bookkeeping tables in database...');

  const dedupeResult = await sql`DELETE FROM lifestream.event_ingest_dedupe WHERE topic = ${TOPIC}`;
  console.log(`  Cleared event_ingest_dedupe: ${dedupeResult.count} rows deleted.`);

  const offsetResult = await sql`DELETE FROM lifestream.kafka_offsets WHERE topic = ${TOPIC}`;
  console.log(`  Cleared kafka_offsets: ${offsetResult.count} rows deleted.`);

  await closeDb();
  await disconnectKafka();

  console.log('\n✅ Kafka topic reset complete!');
  console.log('\nNext steps:');
  console.log('  1. Run: bun run kafka:publish   (to publish events from DB to Kafka)');
  console.log('  2. Run: bun run kafka:materialize   (to consume and materialize)');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
