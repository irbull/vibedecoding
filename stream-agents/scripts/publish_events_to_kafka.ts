import { sql, closeDb } from '../src/lib/db';
import { getProducer, disconnectKafka } from '../src/lib/kafka';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

async function main() {
  const producer = await getProducer();

  console.log('Starting DB -> Kafka Forwarder...');
  console.log('Press Ctrl+C to stop.');

  let consecutiveErrors = 0;

  while (true) {
    try {
      // Query unpublished events
      const events = await sql`
        SELECT *
        FROM lifestream.events
        WHERE published_to_kafka = false
        ORDER BY received_at ASC
        LIMIT 50
      `;

      if (events.length > 0) {
        console.log(`Found ${events.length} unpublished events.`);

        const messages = events.map(e => ({
          key: e.subject_id,
          value: JSON.stringify(e),
          headers: {
            event_type: e.event_type,
            source: e.source
          }
        }));

        await producer.send({
          topic: 'events.raw',
          messages
        });

        // Mark events as published
        const eventIds = events.map(e => e.id);
        await sql`
          UPDATE lifestream.events
          SET published_to_kafka = true
          WHERE id = ANY(${eventIds}::uuid[])
        `;

        console.log(`Published ${events.length} events to Kafka.`);
      }

      // Reset error counter on success
      consecutiveErrors = 0;

    } catch (err) {
      consecutiveErrors++;
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, consecutiveErrors - 1), 30000);

      console.error(`[publisher] Error (attempt ${consecutiveErrors}): ${err instanceof Error ? err.message : err}`);

      if (consecutiveErrors >= MAX_RETRIES) {
        console.error(`[publisher] Max retries (${MAX_RETRIES}) exceeded. Exiting.`);
        throw err;
      }

      console.log(`[publisher] Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (process.argv.includes('--once')) {
      break;
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  await disconnectKafka();
  await closeDb();
  process.exit(0);
}

// Handle shutdown
const shutdown = async () => {
  console.log('\nStopping...');
  await disconnectKafka();
  await closeDb();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(console.error);
