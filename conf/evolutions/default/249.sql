-- Create new schema
-- Create tables/indexes in new schema
-- Grant access to all tables/indexes
-- Update sequences for pkeys of all new tables
-- Apply foreign keys to sidewalk_user table

-- Create Login Schema to unify login systems.

# --- !Ups
CREATE SCHEMA IF NOT EXISTS sidewalk_login;
ALTER SCHEMA sidewalk_login OWNER TO sidewalk;

# --- !Downs
DROP SCHEMA IF EXISTS sidewalk_login CASCADE;

