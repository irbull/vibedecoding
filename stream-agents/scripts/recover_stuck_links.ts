/**
 * Recover Stuck Links
 *
 * Re-emits `enrichment.completed` events for links stuck in 'enriched' status
 * that never received a `publish.completed` event.
 *
 * This follows the event-first pattern: instead of directly updating state,
 * we emit events that flow through the normal pipeline:
 *   1. This script emits `enrichment.completed` events
 *   2. kafka:publish forwards them to Kafka
 *   3. agent:publisher processes them and emits `publish.completed`
 *   4. kafka:materialize updates links.status to 'published'
 *
 * Usage:
 *   bun run recover:stuck --dry-run           # Preview stuck links
 *   bun run recover:stuck --all               # Recover all stuck links
 *   bun run recover:stuck --subject-id <id>   # Recover specific link
 */

import { sql, closeDb } from '../src/lib/db';

// ============================================================
// Types
// ============================================================

interface StuckLink {
  subject_id: string;
  url: string;
  status: string;
  tags: string[];
  summary_short: string | null;
  summary_long: string | null;
  language: string | null;
  model_version: string | null;
}

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs(): {
  subjectId?: string;
  all: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let subjectId: string | undefined;
  let all = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--subject-id':
        subjectId = args[++i];
        break;
      case '--all':
        all = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!subjectId && !all && !dryRun) {
    console.error('Must specify --subject-id, --all, or --dry-run');
    printUsage();
    process.exit(1);
  }

  if (subjectId && all) {
    console.error('Cannot specify both --subject-id and --all');
    printUsage();
    process.exit(1);
  }

  return { subjectId, all, dryRun };
}

function printUsage(): void {
  console.log(`
Usage:
  bun run recover:stuck --dry-run              Preview stuck links without action
  bun run recover:stuck --all                  Recover all stuck links
  bun run recover:stuck --subject-id <id>      Recover a specific link

Options:
  --subject-id <id>   Recover a single link by subject_id
  --all               Recover all stuck links
  --dry-run           Preview what would be recovered (no events emitted)
`);
}

// ============================================================
// Find Stuck Links
// ============================================================

async function findStuckLinks(subjectId?: string): Promise<StuckLink[]> {
  if (subjectId) {
    // Find specific link if it's stuck
    return await sql<StuckLink[]>`
      SELECT l.subject_id, l.url, l.status,
             COALESCE(lm.tags, '{}') as tags,
             lm.summary_short, lm.summary_long, lm.language, lm.model_version
      FROM lifestream.links l
      LEFT JOIN lifestream.link_metadata lm ON l.subject_id = lm.subject_id
      WHERE l.subject_id = ${subjectId}
        AND l.status = 'enriched'
        AND NOT EXISTS (
          SELECT 1 FROM lifestream.events e
          WHERE e.subject_id = l.subject_id
          AND e.event_type = 'publish.completed'
        )
    `;
  }

  // Find all stuck links (enriched but no publish.completed event)
  return await sql<StuckLink[]>`
    SELECT l.subject_id, l.url, l.status,
           COALESCE(lm.tags, '{}') as tags,
           lm.summary_short, lm.summary_long, lm.language, lm.model_version
    FROM lifestream.links l
    LEFT JOIN lifestream.link_metadata lm ON l.subject_id = lm.subject_id
    WHERE l.status = 'enriched'
      AND NOT EXISTS (
        SELECT 1 FROM lifestream.events e
        WHERE e.subject_id = l.subject_id
        AND e.event_type = 'publish.completed'
      )
    ORDER BY l.created_at DESC
  `;
}

// ============================================================
// Event Emission
// ============================================================

async function emitEnrichmentCompleted(link: StuckLink): Promise<void> {
  const payload = {
    tags: link.tags,
    summary_short: link.summary_short,
    summary_long: link.summary_long,
    language: link.language,
    model_version: link.model_version || 'recovery',
  };

  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
    VALUES (now(), 'admin:recovery', 'link', ${link.subject_id}, 'enrichment.completed', ${sql.json(payload)})
  `;
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const { subjectId, all, dryRun } = parseArgs();

  console.log('🔧 Recover Stuck Links');
  console.log(`   Mode: ${dryRun ? 'dry-run (preview only)' : all ? 'all stuck links' : `single link: ${subjectId}`}`);
  console.log('');

  const stuckLinks = await findStuckLinks(subjectId);

  if (stuckLinks.length === 0) {
    if (subjectId) {
      console.log(`Link ${subjectId} is not stuck (either not 'enriched' or already has publish.completed event).`);
    } else {
      console.log('No stuck links found. All enriched links have publish.completed events.');
    }
    await closeDb();
    return;
  }

  console.log(`Found ${stuckLinks.length} stuck link(s):\n`);

  for (const link of stuckLinks) {
    console.log(`  ${link.subject_id}`);
    console.log(`    URL: ${link.url.substring(0, 60)}${link.url.length > 60 ? '...' : ''}`);
    console.log(`    Tags: [${link.tags.join(', ')}]`);
    console.log('');
  }

  if (dryRun || (!all && !subjectId)) {
    console.log('🔍 Dry run complete. No events emitted.');
    console.log('\nTo recover these links, run:');
    console.log('  bun run recover:stuck --all');
    await closeDb();
    return;
  }

  // Emit events
  console.log('Emitting enrichment.completed events...');
  let emitted = 0;

  for (const link of stuckLinks) {
    await emitEnrichmentCompleted(link);
    emitted++;
    process.stdout.write(`\r  Emitted ${emitted}/${stuckLinks.length} events`);
  }

  console.log('\n');
  console.log(`✅ Done! Emitted ${emitted} enrichment.completed event(s).`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Ensure kafka:publish is running (or run with --once)');
  console.log('  2. Ensure agent:publisher is running');
  console.log('  3. Ensure kafka:materialize is running');
  console.log('');
  console.log('The events will flow through the pipeline:');
  console.log('  enrichment.completed -> kafka:publish -> Kafka -> agent:publisher');
  console.log('  -> publish.completed -> kafka:publish -> Kafka -> kafka:materialize');
  console.log('  -> links.status = "published"');
  console.log('');

  await closeDb();
}

main().catch(err => {
  console.error('Error:', err);
  closeDb().finally(() => process.exit(1));
});
