/**
 * Database client for Astro SSG builds
 * Connects to lifestream schema to fetch published links
 */

import postgres from 'postgres';

// For SSG builds, we need DATABASE_URL at build time
// Astro uses import.meta.env (powered by Vite) instead of process.env
const DATABASE_URL = import.meta.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable. Add it to .env file.');
}

// Create postgres client with conservative settings for build-time use
export const sql = postgres(DATABASE_URL, {
  max: 5,              // Smaller pool for build-time
  idle_timeout: 10,
  connect_timeout: 10,
});

// ============================================================
// Types for Stream Page
// ============================================================

export interface PublishedLink {
  subject_id: string;
  url: string;
  created_at: Date;
  title: string | null;
  summary_short: string | null;
  tags: string[];
  published_at: Date | null;
}

// ============================================================
// Query Functions
// ============================================================

/**
 * Fetch all published public links with their content and metadata
 * Ordered by publish date (most recent first)
 */
export async function getPublishedLinks(): Promise<PublishedLink[]> {
  const rows = await sql<PublishedLink[]>`
    SELECT
      l.subject_id,
      l.url,
      l.created_at,
      lc.title,
      lm.summary_short,
      COALESCE(lm.tags, '{}') as tags,
      ps.last_published_at as published_at
    FROM lifestream.links l
    LEFT JOIN lifestream.link_content lc ON l.subject_id = lc.subject_id
    LEFT JOIN lifestream.link_metadata lm ON l.subject_id = lm.subject_id
    LEFT JOIN lifestream.publish_state ps ON l.subject_id = ps.subject_id
    WHERE l.status = 'published'
      AND l.visibility = 'public'
    ORDER BY ps.last_published_at DESC NULLS LAST, l.created_at DESC
  `;

  return rows;
}

/**
 * Close database connection (for cleanup after build)
 */
export async function closeDb(): Promise<void> {
  await sql.end();
}
