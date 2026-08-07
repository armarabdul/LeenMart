-- Extensions the platform depends on (SDD 3.3).
--
-- Created at container init so a fresh local database matches what the first
-- Prisma migration expects. Production applies the same set via migration.

CREATE EXTENSION IF NOT EXISTS postgis;          -- delivery radius, serviceability
CREATE EXTENSION IF NOT EXISTS pg_trgm;          -- Phase-1 fuzzy catalogue search
CREATE EXTENSION IF NOT EXISTS btree_gist;       -- exclusion constraints on slots
CREATE EXTENSION IF NOT EXISTS pg_stat_statements; -- slow-query analysis

-- Separate database used by the integration test suite so a test run can never
-- truncate development data.
SELECT 'CREATE DATABASE leenmart_test OWNER leenmart'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'leenmart_test')\gexec
