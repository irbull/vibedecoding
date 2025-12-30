-- ============================================================
-- Lifestream Schema Permissions & Row Level Security
-- ============================================================
-- 
-- This file sets up:
-- 1. Schema and table grants for API roles
-- 2. Row Level Security (RLS) to restrict access to service_role only
--
-- Run this AFTER adding 'lifestream' to exposed schemas in Supabase
-- Dashboard → Settings → API → Exposed schemas
-- ============================================================

-- ============================================================
-- PART 1: Grant schema and table permissions to API roles
-- ============================================================

-- Grant schema usage to the API roles
GRANT USAGE ON SCHEMA lifestream TO anon, authenticated, service_role;

-- Grant table permissions  
GRANT ALL ON ALL TABLES IN SCHEMA lifestream TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA lifestream TO anon, authenticated, service_role;

-- For future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA lifestream 
GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA lifestream 
GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;


-- ============================================================
-- PART 2: Enable Row Level Security (RLS) on all tables
-- ============================================================
-- This protects data even though schema is exposed to PostgREST

ALTER TABLE lifestream.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.link_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.link_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.publish_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.temperature_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.temperature_latest ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.site_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.kafka_offsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifestream.event_ingest_dedupe ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- PART 3: Create RLS policies - service_role gets full access
-- ============================================================
-- service_role bypasses RLS by default, but explicit policies are good practice
-- anon and authenticated roles will be blocked (no policies for them)

-- subjects
CREATE POLICY "service_role_all" ON lifestream.subjects
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- events
CREATE POLICY "service_role_all" ON lifestream.events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- links
CREATE POLICY "service_role_all" ON lifestream.links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- link_content
CREATE POLICY "service_role_all" ON lifestream.link_content
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- link_metadata
CREATE POLICY "service_role_all" ON lifestream.link_metadata
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- annotations
CREATE POLICY "service_role_all" ON lifestream.annotations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- publish_state
CREATE POLICY "service_role_all" ON lifestream.publish_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- temperature_readings
CREATE POLICY "service_role_all" ON lifestream.temperature_readings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- temperature_latest
CREATE POLICY "service_role_all" ON lifestream.temperature_latest
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- todos
CREATE POLICY "service_role_all" ON lifestream.todos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- site_builds
CREATE POLICY "service_role_all" ON lifestream.site_builds
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- kafka_offsets
CREATE POLICY "service_role_all" ON lifestream.kafka_offsets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- event_ingest_dedupe
CREATE POLICY "service_role_all" ON lifestream.event_ingest_dedupe
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================
-- OPTIONAL: Public read access for published links
-- ============================================================
-- Uncomment these if you want anon users to read public links via REST API

-- CREATE POLICY "anon_read_public_links" ON lifestream.links
--   FOR SELECT TO anon USING (visibility = 'public');

-- CREATE POLICY "anon_read_link_content" ON lifestream.link_content
--   FOR SELECT TO anon USING (
--     EXISTS (SELECT 1 FROM lifestream.links WHERE links.subject_id = link_content.subject_id AND visibility = 'public')
--   );

-- CREATE POLICY "anon_read_link_metadata" ON lifestream.link_metadata
--   FOR SELECT TO anon USING (
--     EXISTS (SELECT 1 FROM lifestream.links WHERE links.subject_id = link_metadata.subject_id AND visibility = 'public')
--   );
