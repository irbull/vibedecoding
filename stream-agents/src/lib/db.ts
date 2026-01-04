/**
 * Database client for lifestream schema
 * Uses direct PostgreSQL connection (bypasses PostgREST)
 */

import postgres from "postgres";

// Load environment variables
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}

// Create postgres client
export const sql = postgres(DATABASE_URL, {
  // Connection pool settings
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// ============================================================
// Type Definitions
// ============================================================

export interface Subject {
  subject: string;
  subject_id: string;
  created_at: string;
  display_name?: string;
  visibility: "public" | "private" | "unlisted";
  meta: Record<string, unknown>;
}

export interface Event {
  id?: string;
  occurred_at: string;
  ingested_at?: string;
  source: string;
  subject: string;
  subject_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export type LinkStatus = "new" | "fetched" | "enriched" | "published" | "error";

export interface Link {
  subject_id: string;
  url: string;
  url_norm: string;
  created_at: string;
  source: string;
  status: LinkStatus;
  visibility: "public" | "private" | "unlisted";
  pinned: boolean;
  retry_count: number;
  last_error_at: string | null;
  last_error: string | null;
}

export interface LinkContent {
  subject_id: string;
  final_url?: string;
  title?: string;
  text_content?: string;
  html_storage_key?: string | null;
  fetched_at?: string;
  fetch_error?: string | null;
}

export interface LinkMetadata {
  subject_id: string;
  tags?: string[];
  summary_short?: string;
  summary_long?: string;
  language?: string;
  model_version?: string;
}

export interface Todo {
  subject_id: string;
  title: string;
  project?: string;
  labels?: string[];
  status: "open" | "done";
  due_at?: string | null;
  completed_at?: string | null;
  meta?: Record<string, unknown>;
}

export interface TemperatureReading {
  subject_id: string;
  occurred_at: string;
  celsius: number;
  humidity?: number;
  battery?: number;
}

export interface TemperatureLatest {
  subject_id: string;
  occurred_at: string;
  celsius: number;
  humidity?: number;
  battery?: number;
}

// Helper to close the connection pool
export async function closeDb(): Promise<void> {
  await sql.end();
}
