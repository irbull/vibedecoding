/**
 * share-link Edge Function
 * 
 * Accepts a URL and creates a link in the lifestream schema:
 * - Normalizes the URL
 * - Generates deterministic subject_id (link:<sha256>)
 * - Inserts into subjects, links, and events tables
 * 
 * POST /functions/v1/share-link
 * Body: { url: string, source?: string }
 * Returns: { success: boolean, subject_id?: string, error?: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

// CORS headers for browser requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Normalize a URL for consistent hashing:
 * - Lowercase scheme and host
 * - Remove default ports (80, 443)
 * - Sort query parameters
 * - Remove trailing slashes (except root)
 * - Remove fragments
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    // Lowercase scheme and host
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    
    // Remove default ports
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    
    // Sort query parameters
    const params = new URLSearchParams(parsed.search);
    const sortedParams = new URLSearchParams([...params.entries()].sort());
    parsed.search = sortedParams.toString();
    
    // Remove fragment
    parsed.hash = "";
    
    // Build normalized URL
    let normalized = parsed.toString();
    
    // Remove trailing slash (except for root path)
    if (normalized.endsWith("/") && parsed.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    
    return normalized;
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Generate SHA256 hash of a string (first 16 chars)
 */
async function sha256Short(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex.slice(0, 16);
}

/**
 * Generate a link subject_id from a URL
 */
async function linkSubjectId(url: string): Promise<string> {
  const normalized = normalizeUrl(url);
  const hash = await sha256Short(normalized);
  return `link:${hash}`;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { 
        status: 405, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  try {
    // Parse request body
    const body = await req.json();
    const { url, source = "unknown" } = body;

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid 'url' field" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid URL format" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Create Supabase client with service role (server-side)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema: "lifestream" },
      auth: { persistSession: false },
    });

    // Generate identifiers
    const urlNorm = normalizeUrl(url);
    const subjectId = await linkSubjectId(url);
    const occurredAt = new Date().toISOString();

    console.log(`[share-link] Processing URL: ${url}`);
    console.log(`[share-link] Normalized: ${urlNorm}`);
    console.log(`[share-link] Subject ID: ${subjectId}`);

    // 1. Upsert into subjects
    const { error: subjectError } = await supabase
      .from("subjects")
      .upsert({
        subject: "link",
        subject_id: subjectId,
        created_at: occurredAt,
        visibility: "public",
        meta: {},
      }, { onConflict: "subject,subject_id" });

    if (subjectError) {
      console.error("[share-link] Subject insert error:", subjectError);
      throw new Error(`Failed to insert subject: ${subjectError.message}`);
    }

    // 2. Upsert into links
    const { error: linkError } = await supabase
      .from("links")
      .upsert({
        subject_id: subjectId,
        url: url,
        url_norm: urlNorm,
        created_at: occurredAt,
        source: source,
        status: "new",
        visibility: "public",
        pinned: false,
      }, { onConflict: "subject_id" });

    if (linkError) {
      console.error("[share-link] Link insert error:", linkError);
      throw new Error(`Failed to insert link: ${linkError.message}`);
    }

    // 3. Insert event (link.added)
    const { error: eventError } = await supabase
      .from("events")
      .insert({
        occurred_at: occurredAt,
        source: source,
        subject: "link",
        subject_id: subjectId,
        event_type: "link.added",
        payload: { url, url_norm: urlNorm, source },
      });

    if (eventError) {
      console.error("[share-link] Event insert error:", eventError);
      throw new Error(`Failed to insert event: ${eventError.message}`);
    }

    console.log(`[share-link] ✓ Successfully created link: ${subjectId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        subject_id: subjectId,
        url_norm: urlNorm,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("[share-link] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
