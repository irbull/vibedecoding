import { sql } from '../src/lib/db';
import { getProducer, disconnectKafka } from '../src/lib/kafka';
import { readFile, writeFile } from 'fs/promises';

const CHECKPOINT_FILE = '.checkpoint';

interface Checkpoint {
  timestamp: string;
  id: string;
}

async function getCheckpoint(): Promise<Checkpoint> {
  try {
    const data = await readFile(CHECKPOINT_FILE, 'utf-8');
    const [timestamp, id] = data.trim().split(',');
    if (!timestamp) throw new Error('Invalid checkpoint');
    return { 
      timestamp, 
      id: id || '00000000-0000-0000-0000-000000000000' 
    };
  } catch {
    return { 
      timestamp: '1970-01-01T00:00:00.000Z', 
      id: '00000000-0000-0000-0000-000000000000' 
    };
  }
}

async function saveCheckpoint(cp: Checkpoint) {
  await writeFile(CHECKPOINT_FILE, `${cp.timestamp},${cp.id}`, 'utf-8');
}

async function main() {
  const producer = await getProducer();
  
  console.log('Starting DB -> Kafka Forwarder...');
  console.log('Press Ctrl+C to stop.');
  
  while (true) {
    const cp = await getCheckpoint();
    
    // Use tuple comparison for stable pagination even with duplicate timestamps
    // Cast to text to ensure strict lexicographical comparison matching the checkpoint string
    const events = await sql`
      SELECT *, received_at::text as received_at_str 
      FROM lifestream.events 
      WHERE (received_at::text, id) > (${cp.timestamp}, ${cp.id}::uuid)
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
        timestamp: lastEvent.received_at_str as string,
        id: lastEvent.id as string
      };
      
      await saveCheckpoint(newCheckpoint);
      console.log(`Published ${events.length} events. Checkpoint updated to ${newCheckpoint.timestamp},${newCheckpoint.id}`);
    } else {
      // Silent polling
    }

    // Sleep 5s
    if (process.argv.includes('--once')) {
      break;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  
  await disconnectKafka();
  process.exit(0);
}

// Handle shutdown
const shutdown = async () => {
  console.log('\nStopping...');
  await disconnectKafka();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(console.error);
