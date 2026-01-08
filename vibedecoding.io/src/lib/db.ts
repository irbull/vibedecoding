/**
 * Database client for Astro SSR
 * Connects to lifestream schema to fetch published links
 * Uses persistent connection pool for server-side rendering
 */

import postgres from 'postgres';

// Astro uses import.meta.env (powered by Vite) instead of process.env
const DATABASE_URL = import.meta.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable. Add it to .env file.');
}

// Create postgres client with settings for SSR
export const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
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

