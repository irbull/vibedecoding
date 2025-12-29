/**
 * Subject ID generation utilities
 * 
 * Subject IDs are stable, deterministic identifiers for entities in the system.
 * Format: "{type}:{identifier}"
 * 
 * Examples:
 * - link:a3f2b1c4d5e6... (SHA256 of normalized URL)
 * - sensor:living_room
 * - todoist:12345
 * - anno:uuid
 */

import { createHash } from "crypto";

/**
 * Normalize a URL for consistent hashing:
 * - Lowercase scheme and host
 * - Remove default ports (80, 443)
 * - Sort query parameters
 * - Remove trailing slashes (except root)
 * - Remove fragments
 */
export function normalizeUrl(url: string): string {
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
    // If URL parsing fails, return original (will still get hashed)
    return url;
  }
}

/**
 * Generate SHA256 hash of a string (first 16 chars for brevity)
 */
export function sha256Short(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Generate a link subject_id from a URL
 * Format: "link:{sha256(normalized_url)}"
 */
export function linkSubjectId(url: string): string {
  const normalized = normalizeUrl(url);
  return `link:${sha256Short(normalized)}`;
}

/**
 * Generate a sensor subject_id
 * Format: "sensor:{location}"
 */
export function sensorSubjectId(location: string): string {
  return `sensor:${location.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Generate a todo subject_id (for external todo systems)
 * Format: "{source}:{external_id}"
 */
export function todoSubjectId(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/**
 * Generate an annotation subject_id
 * Format: "anno:{uuid}"
 */
export function annotationSubjectId(uuid: string): string {
  return `anno:${uuid}`;
}

/**
 * Parse a subject_id into its components
 */
export function parseSubjectId(subjectId: string): { type: string; id: string } {
  const colonIndex = subjectId.indexOf(":");
  if (colonIndex === -1) {
    return { type: "unknown", id: subjectId };
  }
  return {
    type: subjectId.slice(0, colonIndex),
    id: subjectId.slice(colonIndex + 1),
  };
}
