/**
 * Reset Kafka Topics
 *
 * Deletes and recreates all topics (events.raw + work topics) to clear all messages.
 * Also resets event publication status and Kafka offset tracking tables.
 *
 * Run with: bun run scripts/reset_kafka.ts
 */

import { getKafka, disconnectKafka } from '../src/lib/kafka';
import { sql, closeDb } from '../src/lib/db';
import { WORK_TOPICS } from '../src/lib/work_message';

const EVENTS_TOPIC = 'events.raw';
const REPLICATION_FACTOR = 1;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface TopicConfig {
  name: string;
  numPartitions: number;
  retentionMs: number;
}

const TOPICS_TO_RESET: TopicConfig[] = [
  { name: EVENTS_TOPIC, numPartitions: 3, retentionMs: SEVEN_DAYS_MS },
  { name: WORK_TOPICS.FETCH_LINK, numPartitions: 3, retentionMs: SEVEN_DAYS_MS },
  { name: WORK_TOPICS.ENRICH_LINK, numPartitions: 3, retentionMs: SEVEN_DAYS_MS },
  { name: WORK_TOPICS.PUBLISH_LINK, numPartitions: 3, retentionMs: SEVEN_DAYS_MS },
  { name: WORK_TOPICS.DEAD_LETTER, numPartitions: 1, retentionMs: THIRTY_DAYS_MS },
];

async function main() {
  const kafka = getKafka();
  const admin = kafka.admin();

  console.log('🗑️  Resetting Kafka topics and consumer state...\n');

  // 1. Connect to Kafka Admin
  console.log('Connecting to Kafka Admin...');
  await admin.connect();
  console.log('Connected.\n');

  // 2. Get existing topics
  const existingTopics = await admin.listTopics();

  // 3. Delete and recreate each topic
  for (const topicConfig of TOPICS_TO_RESET) {
    if (existingTopics.includes(topicConfig.name)) {
      console.log(`Deleting topic '${topicConfig.name}'...`);
      await admin.deleteTopics({ topics: [topicConfig.name] });
      console.log(`Topic '${topicConfig.name}' deleted.`);
    } else {
      console.log(`Topic '${topicConfig.name}' does not exist, will create.`);
    }
  }

  // Wait for deletion to propagate
  console.log('\nWaiting for deletion to propagate...');
  await new Promise(r => setTimeout(r, 2000));

  // 4. Recreate all topics
  console.log('\nRecreating topics...');
  for (const topicConfig of TOPICS_TO_RESET) {
    console.log(`Creating topic '${topicConfig.name}'...`);
    await admin.createTopics({
      topics: [{
        topic: topicConfig.name,
        numPartitions: topicConfig.numPartitions,
        replicationFactor: REPLICATION_FACTOR,
        configEntries: [
          { name: 'retention.ms', value: String(topicConfig.retentionMs) }
        ]
      }]
    });
    console.log(`Topic '${topicConfig.name}' created with ${topicConfig.numPartitions} partition(s).`);
  }

  await admin.disconnect();

  // 5. Reset event publication status (mark all events as unpublished for replay)
  console.log('\nResetting event publication status...');
  const eventResult = await sql`UPDATE lifestream.events SET published_to_kafka = false`;
  console.log(`  Reset published_to_kafka: ${eventResult.count} events marked as unpublished.`);

  // 6. Clear Kafka offset tracking tables in DB for all topics
  console.log('\nClearing Kafka bookkeeping tables in database...');

  const allTopicNames = TOPICS_TO_RESET.map(t => t.name);

  const dedupeResult = await sql`DELETE FROM lifestream.event_ingest_dedupe WHERE topic = ANY(${allTopicNames})`;
  console.log(`  Cleared event_ingest_dedupe: ${dedupeResult.count} rows deleted.`);

  const offsetResult = await sql`DELETE FROM lifestream.kafka_offsets WHERE topic = ANY(${allTopicNames})`;
  console.log(`  Cleared kafka_offsets: ${offsetResult.count} rows deleted.`);

  await closeDb();
  await disconnectKafka();

  console.log('\n✅ Kafka topics reset complete!');
  console.log('\nNext steps:');
  console.log('  1. Run: bun run kafka:publish      (to publish events from DB to Kafka)');
  console.log('  2. Run: bun run router             (to route events to work topics)');
  console.log('  3. Run: bun run kafka:materialize  (to consume and materialize)');
  console.log('  4. Run: bun run agent:fetcher      (to process fetch work)');
  console.log('  5. Run: bun run agent:enricher     (to process enrich work)');
  console.log('  6. Run: bun run agent:publisher    (to process publish work)');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
