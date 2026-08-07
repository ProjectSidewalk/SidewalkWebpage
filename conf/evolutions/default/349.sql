# --- !Ups
-- The saturating-cotangent lat/lng estimator (#4765/#4766): new labels store computation_method 'approximation3'
-- (see ComputationMethod.scala and PanoDataService.toLatLng). Adding an enum value inside a transaction is fine on
-- PG 12+ as long as the same transaction doesn't use it, and nothing here does -- note that evolutions run with
-- autocommit=false, so the backfill of stored 'approximation2' rows must wait for a later deploy's evolution (only
-- runtime code may use the value until this transaction commits). IF NOT EXISTS guards re-application across city
-- schemas (331/343 precedent).
ALTER TYPE computation_method ADD VALUE IF NOT EXISTS 'approximation3';

# --- !Downs
-- Intentionally a no-op. Postgres cannot drop an enum value without rebuilding the type and recasting the label_point
-- column, and an unused extra enum value is harmless, so removing it is not worth a full type rebuild (331.sql
-- precedent).
SELECT 1;
