# --- !Ups
-- Register Panoramax as a pano source (#5185): the French open street-level imagery commons, rendered by the
-- PanoramaxViewer frontend class. Kept in sync with the PanoSource Scala enum in PanoDataTable.scala. IF NOT EXISTS
-- guards re-application across city schemas that may already have the value. Enum types need no OWNER TO
-- reassignment -- the app role's default USAGE is sufficient and they are never altered at runtime.
ALTER TYPE pano_source ADD VALUE IF NOT EXISTS 'panoramax';

# --- !Downs
-- Intentionally a no-op. Postgres cannot drop an enum value without recreating the type and recasting every column that
-- references it (pano_data.source). An unused extra enum value is harmless, so removing it is not worth a type rebuild.
SELECT 1;
