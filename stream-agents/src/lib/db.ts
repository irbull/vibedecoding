/**
 * Database client for Supabase
 * 
 * Note: We use the Supabase client but query the 'lifestream' schema directly.
 * For tables in a custom schema, we use raw SQL via .rpc() or direct queries.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
  );
}

// Create Supabase client with service role key (bypasses RLS)
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    db: {
      schema: "lifestream", // Use our custom schema
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

/**
 * Execute a raw SQL query using Supabase's rpc or direct query
 * This is useful for complex operations or when we need schema-qualified queries
 */
export async function executeSql<T = unknown>(
  sql: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  // For now, we'll use the Supabase client's built-in query capabilities
  // The schema is set in the client config above
  const { data, error } = await supabase.rpc("exec_sql", { sql, params });
  
  if (error) {
    throw new Error(`SQL execution failed: ${error.message}`);
  }
  
  return data as T[];
}

/**
 * Test database connectivity
 */
export async function testConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("subjects")
      .select("count")
      .limit(1);
    
    if (error && error.code !== "PGRST116") {
      // PGRST116 = "No rows returned" - that's fine for empty table
      console.error("Connection test failed:", error.message);
      return false;
    }
    
    console.log("✓ Database connection successful");
    return true;
  } catch (err) {
    console.error("Connection test failed:", err);
    return false;
  }
}

// Type definitions for our tables
export interface Subject {
  subject: string;
  subject_id: string;
  created_at: string;
  display_name: string | null;
  visibility: "private" | "public";
  meta: Record<string, unknown>;
}

export interface Event {
  id?: string;
  occurred_at: string;
  received_at?: string;
  source: string;
  subject: string;
  subject_id: string;
  event_type: string;
  schema_version?: number;
  payload: Record<string, unknown>;
  correlation_id?: string | null;
  causation_id?: string | null;
}

export interface Link {
  subject_id: string;
  url: string;
  url_norm: string;
  created_at?: string;
  source: string | null;
  status: "new" | "fetched" | "enriched" | "published" | "failed";
  visibility: "private" | "public";
  pinned: boolean;
}

export interface LinkContent {
  subject_id: string;
  final_url: string | null;
  title: string | null;
  text_content: string | null;
  html_storage_key: string | null;
  fetched_at: string | null;
  fetch_error: string | null;
}

export interface LinkMetadata {
  subject_id: string;
  tags: string[];
  summary_short: string | null;
  summary_long: string | null;
  language: string | null;
  model_version: string | null;
  updated_at?: string;
}

export interface Todo {
  subject_id: string;
  title: string;
  project: string | null;
  labels: string[];
  status: "open" | "done" | "archived";
  due_at: string | null;
  completed_at: string | null;
  updated_at?: string;
  meta: Record<string, unknown>;
}

export interface TemperatureReading {
  subject_id: string;
  occurred_at: string;
  celsius: number;
  humidity: number | null;
  battery: number | null;
}

export interface TemperatureLatest {
  subject_id: string;
  occurred_at: string;
  celsius: number;
  humidity: number | null;
  battery: number | null;
  updated_at?: string;
}
