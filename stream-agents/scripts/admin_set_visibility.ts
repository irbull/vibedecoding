/**
 * Admin: Set Link Visibility (Event-First Pattern)
 *
 * Instead of directly updating the database, this script emits
 * `link.visibility_changed` events. The materializer then processes
 * these events and updates the state tables.
 *
 * This ensures:
 * - Complete audit trail of all visibility changes
 * - Replay-safe: reset and replay always produces correct state
 * - Consistent with event-sourcing architecture
 *
 * Usage:
 *   bun run admin:set-visibility --subject-id link:abc123 --visibility public
 *   bun run admin:set-visibility --all --visibility public
 *   bun run admin:set-visibility --all --status enriched --visibility public
 *   bun run admin:set-visibility --all --visibility public --dry-run
 */

import { sql, closeDb } from '../src/lib/db';

// ============================================================
// Types
// ============================================================

interface Link {
  subject_id: string;
  url: string;
  status: string;
  visibility: string;
}

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs(): {
  subjectId?: string;
  all: boolean;
  visibility: 'public' | 'private';
  status?: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let subjectId: string | undefined;
  let all = false;
  let visibility: 'public' | 'private' | undefined;
  let status: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--subject-id':
        subjectId = args[++i];
        break;
      case '--all':
        all = true;
        break;
      case '--visibility':
        const v = args[++i];
        if (v !== 'public' && v !== 'private') {
          console.error(`Invalid visibility: ${v}. Must be 'public' or 'private'.`);
          process.exit(1);
        }
        visibility = v;
        break;
      case '--status':
        status = args[++i];
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

  if (!visibility) {
    console.error('Missing required argument: --visibility');
    printUsage();
    process.exit(1);
  }

  if (!subjectId && !all) {
    console.error('Must specify either --subject-id or --all');
    printUsage();
    process.exit(1);
  }

  if (subjectId && all) {
    console.error('Cannot specify both --subject-id and --all');
    printUsage();
    process.exit(1);
  }

  return { subjectId, all, visibility, status, dryRun };
}

function printUsage(): void {
  console.log(`
Usage:
  bun run admin:set-visibility --subject-id <id> --visibility <public|private>
  bun run admin:set-visibility --all --visibility <public|private> [--status <status>]

Options:
  --subject-id <id>     Change visibility for a single link
  --all                 Change visibility for all links
  --visibility <v>      Required: 'public' or 'private'
  --status <status>     Filter by status (new, fetched, enriched, published, error)
  --dry-run             Preview changes without emitting events
`);
}

// ============================================================
// Event Emission
// ============================================================

async function emitVisibilityChangedEvent(
  subjectId: string,
  visibility: 'public' | 'private'
): Promise<void> {
  const payload = { visibility };

  await sql`
    INSERT INTO lifestream.events (occurred_at, source, subject, subject_id, event_type, payload)
    VALUES (now(), 'admin:set-visibility', 'link', ${subjectId}, 'link.visibility_changed', ${sql.json(payload)})
  `;
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const { subjectId, all, visibility, status, dryRun } = parseArgs();

  console.log('🔐 Admin: Set Link Visibility');
  console.log(`   Target visibility: ${visibility}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log('');

  let links: Link[];

  if (subjectId) {
    // Single link
    links = await sql<Link[]>`
      SELECT subject_id, url, status, visibility
      FROM lifestream.links
      WHERE subject_id = ${subjectId}
    `;

    if (links.length === 0) {
      console.error(`Link not found: ${subjectId}`);
      process.exit(1);
    }
  } else {
    // All links (with optional status filter)
    if (status) {
      links = await sql<Link[]>`
        SELECT subject_id, url, status, visibility
        FROM lifestream.links
        WHERE status = ${status}
        ORDER BY created_at DESC
      `;
    } else {
      links = await sql<Link[]>`
        SELECT subject_id, url, status, visibility
        FROM lifestream.links
        ORDER BY created_at DESC
      `;
    }
  }

  // Filter out links that already have the target visibility
  const linksToChange = links.filter(link => link.visibility !== visibility);

  console.log(`Found ${links.length} link(s), ${linksToChange.length} need visibility change:`);
  console.log('');

  if (linksToChange.length === 0) {
    console.log('Nothing to do.');
    await closeDb();
    return;
  }

  // Show preview
  for (const link of linksToChange) {
    console.log(`  ${link.subject_id}`);
    console.log(`    URL: ${link.url.substring(0, 60)}${link.url.length > 60 ? '...' : ''}`);
    console.log(`    Status: ${link.status}`);
    console.log(`    Visibility: ${link.visibility} -> ${visibility}`);
    console.log('');
  }

  if (dryRun) {
    console.log('🔍 Dry run complete. No events emitted.');
    await closeDb();
    return;
  }

  // Emit events
  console.log('Emitting events...');
  let emitted = 0;

  for (const link of linksToChange) {
    await emitVisibilityChangedEvent(link.subject_id, visibility);
    emitted++;
    process.stdout.write(`\r  Emitted ${emitted}/${linksToChange.length} events`);
  }

  console.log('\n');
  console.log(`✅ Done! Emitted ${emitted} event(s).`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run kafka:publish to forward events to Kafka');
  console.log('  2. Run kafka:materialize to process events and update state');
  console.log('');

  await closeDb();
}

main().catch(err => {
  console.error('Error:', err);
  closeDb().finally(() => process.exit(1));
});
