import { sql, closeDb } from '../src/lib/db';
import { getProducer, disconnectKafka } from '../src/lib/kafka';

const PUBLISHER_ID = 'default';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

interface Checkpoint {
  timestamp: Date | string;
  id: string;
}

async function getCheckpoint(): Promise<Checkpoint> {
  const result = await sql`
    SELECT last_timestamp, last_event_id::text
    FROM lifestream.publisher_checkpoint
    WHERE publisher_id = ${PUBLISHER_ID}
  `;

  if (result.length > 0) {
    return {
      timestamp: result[0].last_timestamp,
      id: result[0].last_event_id,
    };
  }

  // No checkpoint exists yet - start from beginning
  return {
    timestamp: '1970-01-01T00:00:00.000Z',
    id: '00000000-0000-0000-0000-000000000000',
  };
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await sql`
    INSERT INTO lifestream.publisher_checkpoint (publisher_id, last_timestamp, last_event_id)
    VALUES (${PUBLISHER_ID}, ${cp.timestamp}, ${cp.id}::uuid)
    ON CONFLICT (publisher_id) DO UPDATE SET
      last_timestamp = EXCLUDED.last_timestamp,
      last_event_id = EXCLUDED.last_event_id,
      updated_at = now()
  `;
}

async function main() {
  const producer = await getProducer();

  console.log('Starting DB -> Kafka Forwarder...');
  console.log('Press Ctrl+C to stop.');

  let consecutiveErrors = 0;

  while (true) {
    try {
      const cp = await getCheckpoint();

      // Get events after checkpoint: use >= on timestamp and exclude the checkpoint ID
      // This avoids JS Date millisecond precision loss issues with Postgres microseconds
      const events = await sql`
        SELECT *
        FROM lifestream.events
        WHERE received_at >= ${cp.timestamp}
          AND id != ${cp.id}::uuid
        ORDER BY received_at ASC, id ASC
        LIMIT 50
      `;

      if (events.length > 0) {
        console.log(`Found ${events.length} new events.`);

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

        const lastEvent = events[events.length - 1];
        const newCheckpoint = {
          timestamp: lastEvent.received_at,
          id: lastEvent.id as string
        };

        await saveCheckpoint(newCheckpoint);
        console.log(`Published ${events.length} events. Checkpoint: ${newCheckpoint.id}`);
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
