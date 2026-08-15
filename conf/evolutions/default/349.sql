# --- !Ups
-- The saturating-cotangent lat/lng estimator (#4765/#4766): new labels store computation_method 'approximation3'
-- (see ComputationMethod.scala and PanoDataService.toLatLng). Adding an enum value inside a transaction is fine on
-- PG 12+ as long as the same transaction doesn't use it, and nothing here does -- note that evolutions run with
-- autocommit=false, so every pending evolution shares one transaction and a later-numbered file would not escape
-- this. Only runtime code, which runs after the commit, may use the value. So the backfill that recomputes stored
-- 'approximation2' rows (#4818) has to rebuild the type outright the way 342.sql did -- cast the column to text,
-- DROP/CREATE the type with the new value, UPDATE, cast back -- because on any database where this file is still
-- pending (CI, a fresh dev DB, a newly created city schema) the two apply together and an UPDATE naming
-- 'approximation3' fails with "unsafe use of new value". IF NOT EXISTS guards re-application across city schemas
-- (331/343 precedent).
ALTER TYPE computation_method ADD VALUE IF NOT EXISTS 'approximation3';

# --- !Downs
-- Intentionally a no-op. Postgres cannot drop an enum value without rebuilding the type and recasting the label_point
-- column, and an unused extra enum value is harmless, so removing it is not worth a full type rebuild (331.sql
-- precedent).
SELECT 1;
