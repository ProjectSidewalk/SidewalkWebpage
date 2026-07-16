# --- !Ups
-- The free-exploration mission type behind /explore?lat&lng (#4451). Adding a value inside a transaction is fine on
-- PG 12+ as long as the same transaction doesn't use it, and nothing here does -- note that evolutions run with
-- autocommit=false, so every pending evolution shares one transaction and a later-numbered file would not escape this.
-- IF NOT EXISTS guards re-application across city schemas that may already have the value (331/332/339 precedent).
ALTER TYPE mission_type ADD VALUE IF NOT EXISTS 'exploreAddress';

-- Partial-audit distance persisted from the client on every explore submission. Deliberately never read anywhere: it
-- accumulates real data so a future fractional-coverage model has history to build on (#4451).
ALTER TABLE audit_task ADD COLUMN audited_distance_m DOUBLE PRECISION;

# --- !Downs
ALTER TABLE audit_task DROP COLUMN audited_distance_m;
-- The mission_type value is intentionally not reverted. Postgres cannot drop an enum value without rebuilding the type
-- and recasting the column, which would also mean deleting the missions still using it. An unused extra enum value is
-- harmless, so removing it is not worth a full type rebuild plus data loss (331.sql precedent).
