# --- !Ups
-- Adds the DEFAULTs that were missing from NOT NULL columns whose every writer supplies the same zero value (#4822).
-- With a default, a partial INSERT (like the raw ON CONFLICT upserts) no longer has to name columns it has no
-- opinion about, and the schema stops looking like the missing ones were deliberate.

-- Flags that start out false, matching audit_task.completed, label.deleted and the other flags that already default.
ALTER TABLE mission
  ALTER COLUMN completed SET DEFAULT FALSE,
  ALTER COLUMN paid SET DEFAULT FALSE,
  ALTER COLUMN skipped SET DEFAULT FALSE;
ALTER TABLE user_route
  ALTER COLUMN completed SET DEFAULT FALSE,
  ALTER COLUMN discarded SET DEFAULT FALSE;

-- Every route is shown on the public /routes listing, but rows were being inserted with public = FALSE and nothing
-- ever read the column. Make the data say what the site does.
UPDATE route SET public = TRUE WHERE NOT public;
ALTER TABLE route
  ALTER COLUMN public SET DEFAULT TRUE,
  ALTER COLUMN deleted SET DEFAULT FALSE,
  ALTER COLUMN street_count SET DEFAULT 0;

-- Timestamps that every writer sets to "now" at insert time, matching label.time_created and friends.
ALTER TABLE webpage_activity ALTER COLUMN timestamp SET DEFAULT now();
ALTER TABLE audit_task_comment ALTER COLUMN timestamp SET DEFAULT now();
ALTER TABLE street_edge_issue ALTER COLUMN timestamp SET DEFAULT now();
ALTER TABLE background_job_run ALTER COLUMN started_at SET DEFAULT now();
ALTER TABLE osm_way ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE street_imagery ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE place ALTER COLUMN fetched_at SET DEFAULT now();

-- The audit_task_environment sibling has defaulted to 'en' all along, and nothing distinguishes these two from it.
ALTER TABLE validation_task_environment ALTER COLUMN language SET DEFAULT 'en';
ALTER TABLE gallery_task_environment ALTER COLUMN language SET DEFAULT 'en';

-- The excluded_tags_valid_json CHECK requires a JSON array, so the empty value is '[]' rather than '{}'.
ALTER TABLE config ALTER COLUMN excluded_tags SET DEFAULT '[]'::jsonb;

# --- !Downs
ALTER TABLE config ALTER COLUMN excluded_tags DROP DEFAULT;

ALTER TABLE gallery_task_environment ALTER COLUMN language DROP DEFAULT;
ALTER TABLE validation_task_environment ALTER COLUMN language DROP DEFAULT;

ALTER TABLE place ALTER COLUMN fetched_at DROP DEFAULT;
ALTER TABLE street_imagery ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE osm_way ALTER COLUMN updated_at DROP DEFAULT;
ALTER TABLE background_job_run ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE street_edge_issue ALTER COLUMN timestamp DROP DEFAULT;
ALTER TABLE audit_task_comment ALTER COLUMN timestamp DROP DEFAULT;
ALTER TABLE webpage_activity ALTER COLUMN timestamp DROP DEFAULT;

-- The public = TRUE backfill is left in place: it corrected the data rather than changing its meaning.
ALTER TABLE route
  ALTER COLUMN street_count DROP DEFAULT,
  ALTER COLUMN deleted DROP DEFAULT,
  ALTER COLUMN public DROP DEFAULT;

ALTER TABLE user_route
  ALTER COLUMN discarded DROP DEFAULT,
  ALTER COLUMN completed DROP DEFAULT;
ALTER TABLE mission
  ALTER COLUMN skipped DROP DEFAULT,
  ALTER COLUMN paid DROP DEFAULT,
  ALTER COLUMN completed DROP DEFAULT;
