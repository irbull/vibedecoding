/**
 * Fetcher Agent
 *
 * Consumes `link.added` events from Kafka, fetches URL content,
 * extracts readable text using Mozilla Readability, and emits
 * `content.fetched` events to Postgres.
 *
 * Uses Option C for race condition handling:
 * - URL comes from event payload (no dependency on materializer)
 * - Only checks if link_content exists (idempotency)
 *
 * Run with: bun run agent:fetcher
 */

import { sql, closeDb } from '../src/lib/db';
import { createConsumer } from '../src/lib/kafka';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { Consumer, EachMessagePayload } from 'kafkajs';

const CONSUMER_GROUP = 'fetcher-agent-v1';
const TOPIC = 'events.raw';
const FETCH_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MS = 1_000;

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

interface FetchResult {
  finalUrl: string;
  title: string | null;
  textContent: string | null;
  error: string | null;
}

// ============================================================
// Rate Limiting
// ============================================================

const lastFetchByDomain = new Map<string, number>();

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

async function rateLimitForDomain(domain: string): Promise<void> {
  const lastFetch = lastFetchByDomain.get(domain);
  if (lastFetch) {
    const elapsed = Date.now() - lastFetch;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
  }
  lastFetchByDomain.set(domain, Date.now());
}

// ============================================================
// Idempotency
// ============================================================

async function contentAlreadyFetched(subjectId: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM lifestream.link_content
    WHERE subject_id = ${subjectId}
  `;
  return result.length > 0;
}

// ============================================================
// Fetch and Extract
// ============================================================

async function fetchAndExtract(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LifestreamBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        finalUrl: response.url,
        title: null,
        textContent: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    // Try Readability extraction
    const reader = new Readability(document);
    const article = reader.parse();

    if (article) {
      return {
        finalUrl: response.url,
        title: article.title,
        textContent: article.textContent,
        error: null,
      };
    }

    // Fallback: extract title from document
    const title = document.querySelector('title')?.textContent ?? null;
    return {
      finalUrl: response.url,
      title,
      textContent: null,
      error: 'Readability could not parse article',
    };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { finalUrl: url, title: null, textContent: null, error: 'Timeout' };
      }
      return { finalUrl: url, title: null, textContent: null, error: err.message };
    }

    return { finalUrl: url, title: null, textContent: null, error: 'Unknown error' };
  }
}

// ============================================================
// Event Emission
// ============================================================

async function emitContentFetched(
  subjectId: string,
  result: FetchResult,
  correlationId?: string
): Promise<void> {
  const payload = {
    final_url: result.finalUrl,
    title: result.title,
    text_content: result.textContent,
    fetch_error: result.error,
  };

  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload, correlation_id)
    VALUES (now(), 'agent:fetcher', 'link', ${subjectId}, 'content.fetched', ${sql.json(payload)}, ${correlationId ?? null})
  `;
}

// ============================================================
// Message Handler
// ============================================================

async function handleMessage({ topic, partition, message }: EachMessagePayload): Promise<void> {
  if (!message.value) {
    return;
  }

  const event: LifestreamEvent = JSON.parse(message.value.toString());

  // Only process link.added events
  if (event.event_type !== 'link.added') {
    return;
  }

  const { url } = event.payload as { url?: string };

  if (!url) {
    console.log(`[fetcher] WARNING: Missing url in payload, skipping: ${event.subject_id}`);
    return;
  }

  // Check if already fetched (idempotency)
  if (await contentAlreadyFetched(event.subject_id)) {
    console.log(`[fetcher] Already fetched: ${event.subject_id}`);
    return;
  }

  console.log(`[fetcher] Fetching: ${url}`);

  // Rate limit per domain
  const domain = getDomain(url);
  await rateLimitForDomain(domain);

  // Fetch and extract content
  const result = await fetchAndExtract(url);

  // Emit content.fetched event
  await emitContentFetched(event.subject_id, result, event.id);

  if (result.error) {
    console.log(`[fetcher] Error for ${event.subject_id}: ${result.error}`);
  } else {
    console.log(`[fetcher] Fetched: ${event.subject_id} -> "${result.title?.slice(0, 50)}..."`);
  }
}

// ============================================================
// Main Consumer Loop
// ============================================================

let consumer: Consumer | null = null;
let isShuttingDown = false;

async function main(): Promise<void> {
  console.log('🌐 Starting Fetcher Agent...');
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

  console.log('\n🛑 Shutting down Fetcher Agent...');

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
