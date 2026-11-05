# --- !Ups
-- A neighborhood report's Gallery cards (#5876) cast votes under their own source, so analyses can tell them apart.
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'Report';

# --- !Downs
-- partial-downs: Postgres can't drop an enum value without rewriting every column of the type, and a stray value is
-- harmless to the previous release, which never writes it.
