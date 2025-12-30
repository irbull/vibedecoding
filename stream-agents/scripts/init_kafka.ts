import { getKafka, disconnectKafka } from '../src/lib/kafka';

async function main() {
  const kafka = getKafka();
  const admin = kafka.admin();

  console.log('Connecting to Kafka Admin...');
  await admin.connect();
  console.log('Connected.');

  const topic = 'events.raw';
  const numPartitions = 3;
  const replicationFactor = 1; // Single node cluster

  console.log(`Checking if topic '${topic}' exists...`);
  const existingTopics = await admin.listTopics();

  if (existingTopics.includes(topic)) {
    console.log(`Topic '${topic}' already exists.`);
  } else {
    console.log(`Creating topic '${topic}'...`);
    const created = await admin.createTopics({
      topics: [{
        topic,
        numPartitions,
        replicationFactor,
        configEntries: [
          { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) } // 7 days
        ]
      }]
    });
    
    if (created) {
      console.log(`Topic '${topic}' created successfully.`);
    } else {
      console.error(`Failed to create topic '${topic}'.`);
    }
  }

  await admin.disconnect();
  await disconnectKafka();
}

main().catch(console.error);
