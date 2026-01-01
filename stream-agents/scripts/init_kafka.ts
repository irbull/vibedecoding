import { getKafka, disconnectKafka } from '../src/lib/kafka';

interface TopicConfig {
  name: string;
  numPartitions: number;
  configEntries: { name: string; value: string }[];
}

const TOPICS: TopicConfig[] = [
  {
    name: 'events.raw',
    numPartitions: 3,
    configEntries: [
      { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) } // 7 days
    ]
  },
  {
    name: 'tags.catalog',
    numPartitions: 1, // Single partition for KTable pattern
    configEntries: [
      { name: 'cleanup.policy', value: 'compact' },
      { name: 'min.compaction.lag.ms', value: '0' },
      { name: 'segment.ms', value: String(60 * 60 * 1000) } // 1 hour segments for faster compaction
    ]
  }
];

async function main() {
  const kafka = getKafka();
  const admin = kafka.admin();

  console.log('Connecting to Kafka Admin...');
  await admin.connect();
  console.log('Connected.');

  const existingTopics = await admin.listTopics();
  const replicationFactor = 1; // Single node cluster

  for (const topicConfig of TOPICS) {
    console.log(`Checking if topic '${topicConfig.name}' exists...`);

    if (existingTopics.includes(topicConfig.name)) {
      console.log(`Topic '${topicConfig.name}' already exists.`);
    } else {
      console.log(`Creating topic '${topicConfig.name}'...`);
      const created = await admin.createTopics({
        topics: [{
          topic: topicConfig.name,
          numPartitions: topicConfig.numPartitions,
          replicationFactor,
          configEntries: topicConfig.configEntries
        }]
      });

      if (created) {
        console.log(`Topic '${topicConfig.name}' created successfully.`);
      } else {
        console.error(`Failed to create topic '${topicConfig.name}'.`);
      }
    }
  }

  await admin.disconnect();
  await disconnectKafka();
}

main().catch(console.error);
