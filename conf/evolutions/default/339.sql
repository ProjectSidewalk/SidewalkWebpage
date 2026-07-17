# --- !Ups
-- Register the story-surface ui_source values (#4054): validations cast from the label popup opened off the user
-- dashboard's "Your stories" list (DashboardStories) and the admin moderation queue (AdminStories). Without these the
-- vote POST's source fails UiSource.withName and the validation is silently dropped. Kept in sync with the UiSource
-- Scala enum in CommonUtils.scala. Adding a value inside a transaction is fine on PG 12+ as long as the same
-- transaction doesn't use it, and this evolution doesn't. IF NOT EXISTS guards re-application across city schemas.
-- Enum types need no OWNER TO reassignment -- the app role's default USAGE is sufficient and they are never altered
-- at runtime.
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'DashboardStories';
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'AdminStories';

# --- !Downs
-- Intentionally a no-op. Postgres cannot drop an enum value without recreating the type and recasting every column
-- that references it (label_history, label_validation, validation_task_interaction). An unused extra enum value is
-- harmless, so removing it is not worth a full type rebuild (331.sql precedent).
SELECT 1;
