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
