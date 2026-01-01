/**
 * Clean Link Helper
 *
 * Removes a link from all pipeline tables so it can be re-processed.
 * Searches by URL, final_url, or subject_id.
 *
 * Usage:
 *   bun run clean:link <url-or-subject-id>
 *   bun run clean:link https://example.com/article
 *   bun run clean:link link:abc123
 *
 * This will delete from:
 *   - link_content (fetcher idempotency)
 *   - link_metadata (enricher idempotency)
 *   - links (status tracking)
 *   - subjects (optional, with --full flag)
 */

import { sql, closeDb } from '../src/lib/db';

async function findSubjectId(search: string): Promise<string | null> {
  // If it looks like a subject_id, use it directly
  if (search.startsWith('link:')) {
    return search;
  }

  // Search by URL in links table
  const byUrl = await sql`
    SELECT subject_id FROM lifestream.links
    WHERE url = ${search} OR url_norm LIKE ${'%' + search + '%'}
    LIMIT 1
  `;
  if (byUrl.length > 0) {
    return byUrl[0].subject_id;
  }

  // Search by final_url in link_content table
  const byFinalUrl = await sql`
    SELECT subject_id FROM lifestream.link_content
    WHERE final_url = ${search} OR final_url LIKE ${'%' + search + '%'}
    LIMIT 1
  `;
  if (byFinalUrl.length > 0) {
    return byFinalUrl[0].subject_id;
  }

  // Search by partial URL match
  const byPartial = await sql`
    SELECT subject_id FROM lifestream.links
    WHERE url LIKE ${'%' + search + '%'}
    LIMIT 1
  `;
  if (byPartial.length > 0) {
    return byPartial[0].subject_id;
  }

  return null;
}

async function cleanLink(subjectId: string, full: boolean): Promise<void> {
  console.log(`\nCleaning link: ${subjectId}`);

  // Get current state for info
  const link = await sql`SELECT url, status FROM lifestream.links WHERE subject_id = ${subjectId}`;
  const content = await sql`SELECT title, fetch_error FROM lifestream.link_content WHERE subject_id = ${subjectId}`;
  const metadata = await sql`SELECT tags, summary_short FROM lifestream.link_metadata WHERE subject_id = ${subjectId}`;

  if (link.length > 0) {
    console.log(`  URL: ${link[0].url}`);
    console.log(`  Status: ${link[0].status}`);
  }
  if (content.length > 0) {
    console.log(`  Title: ${content[0].title || '(none)'}`);
    if (content[0].fetch_error) console.log(`  Fetch Error: ${content[0].fetch_error}`);
  }
  if (metadata.length > 0) {
    console.log(`  Tags: ${metadata[0].tags?.join(', ') || '(none)'}`);
  }

  // Delete from tables
  const contentResult = await sql`DELETE FROM lifestream.link_content WHERE subject_id = ${subjectId}`;
  console.log(`  Deleted from link_content: ${contentResult.count} row(s)`);

  const metadataResult = await sql`DELETE FROM lifestream.link_metadata WHERE subject_id = ${subjectId}`;
  console.log(`  Deleted from link_metadata: ${metadataResult.count} row(s)`);

  // Reset link status instead of deleting
  const linkResult = await sql`
    UPDATE lifestream.links SET status = 'new' WHERE subject_id = ${subjectId}
  `;
  console.log(`  Reset link status to 'new': ${linkResult.count} row(s)`);

  if (full) {
    const linksResult = await sql`DELETE FROM lifestream.links WHERE subject_id = ${subjectId}`;
    console.log(`  Deleted from links: ${linksResult.count} row(s)`);

    const subjectsResult = await sql`DELETE FROM lifestream.subjects WHERE subject_id = ${subjectId}`;
    console.log(`  Deleted from subjects: ${subjectsResult.count} row(s)`);
  }

  console.log('\nDone! The link will be re-processed when the agents see the next event.');
  console.log('Note: You may need to re-share the link to trigger a new link.added event.\n');
}

async function listRecentLinks(): Promise<void> {
  console.log('\nRecent links:\n');

  const links = await sql`
    SELECT l.subject_id, l.url, l.status, lc.title, lm.tags
    FROM lifestream.links l
    LEFT JOIN lifestream.link_content lc ON l.subject_id = lc.subject_id
    LEFT JOIN lifestream.link_metadata lm ON l.subject_id = lm.subject_id
    ORDER BY l.created_at DESC
    LIMIT 10
  `;

  if (links.length === 0) {
    console.log('  No links found.\n');
    return;
  }

  for (const link of links) {
    console.log(`  ${link.subject_id}`);
    console.log(`    URL: ${link.url}`);
    console.log(`    Status: ${link.status}`);
    if (link.title) console.log(`    Title: ${link.title.slice(0, 50)}...`);
    if (link.tags?.length > 0) console.log(`    Tags: ${link.tags.join(', ')}`);
    console.log('');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const search = args.find(a => !a.startsWith('--'));

  if (!search) {
    console.log('Usage: bun run clean:link <url-or-subject-id> [--full]');
    console.log('');
    console.log('Options:');
    console.log('  --full    Also delete from links and subjects tables');
    console.log('');
    await listRecentLinks();
    await closeDb();
    return;
  }

  const subjectId = await findSubjectId(search);

  if (!subjectId) {
    console.error(`\nNo link found matching: ${search}`);
    await listRecentLinks();
    await closeDb();
    process.exit(1);
  }

  await cleanLink(subjectId, full);
  await closeDb();
}

main().catch(err => {
  console.error('Error:', err);
  closeDb().then(() => process.exit(1));
});
