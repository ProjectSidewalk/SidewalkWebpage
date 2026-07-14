# --- !Ups
-- Register the share-page ui_source values (#456): validations cast from the public /label/:id share page. The share
-- page mirrors the Gallery image/thumbs split -- SharedLabelImage for the pano-overlay buttons, SharedLabelThumbs for
-- the vote column -- plus the base SharedLabel source. Kept in sync with the UiSource Scala enum in CommonUtils.scala.
-- IF NOT EXISTS guards re-application across city schemas that may already have a value. Enum types need no OWNER TO
-- reassignment -- the app role's default USAGE is sufficient and they are never altered at runtime.
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'SharedLabel';
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'SharedLabelImage';
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'SharedLabelThumbs';

# --- !Downs
-- Intentionally a no-op. Postgres cannot drop an enum value without recreating the type and recasting every column that
-- references it (label_history, label_validation, validation_task_interaction). An unused extra enum value is harmless,
-- so removing it is not worth a full type rebuild.
SELECT 1;
