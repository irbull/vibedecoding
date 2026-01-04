/**
 * Retry Failed Links Script
 *
 * Finds links with status='error' that haven't exceeded max retries,
 * clears their pipeline state, and re-emits link.added events to trigger reprocessing.
 *
 * Usage:
 *   bun run retry:failed                    # Retry all eligible failed links
 *   bun run retry:failed --dry-run          # Show what would be retried
 *   bun run retry:failed --limit 5          # Retry at most 5 links
 *   bun run retry:failed --subject-id link:abc123  # Retry a specific link
 *   bun run retry:failed --max-retries 5    # Override max retry count
 */

import { sql, closeDb } from '../src/lib/db';

const DEFAULT_MAX_RETRIES = 3;

interface FailedLink {
  subject_id: string;
  url: string;
  url_norm: string;
  source: string | null;
  retry_count: number;
  last_error_at: Date | null;
  last_error: string | null;
}

function parseArgs(): {
  dryRun: boolean;
  limit: number | null;
  subjectId: string | null;
  maxRetries: number;
} {
  const args = process.argv.slice(2);
  let dryRun = false;
  let limit: number | null = null;
  let subjectId: string | null = null;
  let maxRetries = DEFAULT_MAX_RETRIES;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (arg === '--subject-id' && args[i + 1]) {
      subjectId = args[++i];
    } else if (arg === '--max-retries' && args[i + 1]) {
      maxRetries = parseInt(args[++i], 10);
    }
  }

  return { dryRun, limit, subjectId, maxRetries };
}

async function findFailedLinks(
  maxRetries: number,
  limit: number | null,
  subjectId: string | null
): Promise<FailedLink[]> {
  if (subjectId) {
    // Find specific link (regardless of status or retry count for manual override)
    const result = await sql<FailedLink[]>`
      SELECT subject_id, url, url_norm, source, retry_count, last_error_at, last_error
      FROM lifestream.links
      WHERE subject_id = ${subjectId}
    `;
    return result;
  }

  // Find all eligible failed links
  const result = await sql<FailedLink[]>`
    SELECT subject_id, url, url_norm, source, retry_count, last_error_at, last_error
    FROM lifestream.links
    WHERE status = 'error' AND retry_count < ${maxRetries}
    ORDER BY last_error_at ASC NULLS FIRST
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;
  return result;
}

async function cleanLinkState(subjectId: string): Promise<void> {
  // Delete from link_content (fetcher idempotency)
  await sql`DELETE FROM lifestream.link_content WHERE subject_id = ${subjectId}`;

  // Delete from link_metadata (enricher idempotency)
  await sql`DELETE FROM lifestream.link_metadata WHERE subject_id = ${subjectId}`;

  // Reset link status to 'new' (keep retry_count for tracking)
  await sql`
    UPDATE lifestream.links
    SET status = 'new'
    WHERE subject_id = ${subjectId}
  `;
}

async function emitLinkAddedEvent(link: FailedLink): Promise<void> {
  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
    VALUES (
      now(),
      'retry-script',
      'link',
      ${link.subject_id},
      'link.added',
      ${sql.json({ url: link.url, url_norm: link.url_norm, source: 'retry', original_source: link.source })}
    )
  `;
}

async function retryLink(link: FailedLink, dryRun: boolean): Promise<void> {
  console.log(`\n  ${link.subject_id}`);
  console.log(`    URL: ${link.url}`);
  console.log(`    Retry count: ${link.retry_count}`);
  if (link.last_error_at) {
    console.log(`    Last error at: ${link.last_error_at.toISOString()}`);
  }
  if (link.last_error) {
    console.log(`    Error: ${link.last_error}`);
  }

  if (dryRun) {
    console.log(`    [DRY RUN] Would reset and re-emit link.added event`);
    return;
  }

  await cleanLinkState(link.subject_id);
  await emitLinkAddedEvent(link);
  console.log(`    ✓ Reset to 'new' and emitted link.added event`);
}

async function main(): Promise<void> {
  const { dryRun, limit, subjectId, maxRetries } = parseArgs();

  console.log('Retry Failed Links');
  console.log('==================');
  if (dryRun) console.log('Mode: DRY RUN (no changes will be made)');
  console.log(`Max retries: ${maxRetries}`);
  if (limit) console.log(`Limit: ${limit}`);
  if (subjectId) console.log(`Subject ID: ${subjectId}`);

  try {
    const failedLinks = await findFailedLinks(maxRetries, limit, subjectId);

    if (failedLinks.length === 0) {
      if (subjectId) {
        console.log(`\nNo failed link found with subject_id: ${subjectId}`);
      } else {
        console.log(`\nNo failed links found (or all have exceeded ${maxRetries} retries)`);
      }

      // Show links that have exceeded max retries
      const exhaustedLinks = await sql<{ subject_id: string; url: string; retry_count: number }[]>`
        SELECT subject_id, url, retry_count
        FROM lifestream.links
        WHERE status = 'error' AND retry_count >= ${maxRetries}
        ORDER BY retry_count DESC
        LIMIT 10
      `;

      if (exhaustedLinks.length > 0) {
        console.log(`\nLinks that have exceeded max retries (${maxRetries}):`);
        for (const link of exhaustedLinks) {
          console.log(`  ${link.subject_id} (${link.retry_count} retries): ${link.url}`);
        }
        console.log('\nTo retry these manually, use: --subject-id <id>');
      }

      await closeDb();
      return;
    }

    console.log(`\nFound ${failedLinks.length} failed link(s) to retry:`);

    for (const link of failedLinks) {
      await retryLink(link, dryRun);
    }

    if (!dryRun) {
      console.log('\n==================');
      console.log(`Retried ${failedLinks.length} link(s).`);
      console.log('Run kafka:publish to forward events to Kafka.');
      console.log('Run agent:fetcher to reprocess the links.');
    }
  } finally {
    await closeDb();
  }
}

main().catch(err => {
  console.error('Error:', err);
  closeDb().then(() => process.exit(1));
});
