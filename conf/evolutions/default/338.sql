# --- !Ups
-- Add missing NOT NULL, UNIQUE, PRIMARY KEY, and CHECK constraints that the app already assumes but the schema never
-- enforced (issue #3944, follow-on to the foreign-key work in 337). A few small legacy duplicate rows are collapsed
-- first so the unique/PK adds succeed everywhere.

-- === De-duplicate rows that violate the uniqueness enforced below (no-ops where a city is already clean). ===
-- One priority row per street. updateAllStreetEdgePriorities updates priority filtered by street_edge_id, so every
-- duplicate row for a street already carries the same priority and keeping the lowest id loses nothing.
DELETE FROM street_edge_priority
WHERE street_edge_priority_id NOT IN (SELECT MIN(street_edge_priority_id) FROM street_edge_priority GROUP BY street_edge_id);

-- One current-region row per user (a handful of legacy duplicates exist in some cities). Keep the lowest id.
DELETE FROM user_current_region
WHERE user_current_region_id NOT IN (SELECT MIN(user_current_region_id) FROM user_current_region GROUP BY user_id);

-- One point per label. Keep the lowest label_point_id.
DELETE FROM label_point WHERE label_point_id NOT IN (SELECT MIN(label_point_id) FROM label_point GROUP BY label_id);

-- old_label_metadata has no surrogate key, so drop duplicate label_id rows via ctid, keeping one row per label.
DELETE FROM old_label_metadata a USING old_label_metadata b WHERE a.ctid > b.ctid AND a.label_id = b.label_id;

-- pano_history dedups on (pano_id, location_curr_pano_id) in the app (insertIfNew ignores capture_date), so collapse to
-- that key, keeping the earliest capture_date (ties broken by ctid).
DELETE FROM pano_history a USING pano_history b
WHERE a.pano_id = b.pano_id AND a.location_curr_pano_id = b.location_curr_pano_id
  AND (a.capture_date > b.capture_date OR (a.capture_date = b.capture_date AND a.ctid > b.ctid));

-- === Fix corrupt label_point geometry (legacy bad data, ~1.2k rows across 6 cities). ===
-- An old 'depth' position method wrote out-of-range garbage into geom while leaving lat/lng NULL. The current insert
-- path derives geom from lat/lng (a NULL lat/lng yields a NULL geom, never garbage), and the bad coords are
-- unrecoverable, so null the corrupt geom to match its NULL lat/lng ("position unknown"). public.ST_* is qualified
-- because PostGIS lives in public and the evolution runs with the city schema on the search_path.
UPDATE label_point SET geom = NULL
WHERE geom IS NOT NULL AND (public.ST_X(geom) NOT BETWEEN -180 AND 180 OR public.ST_Y(geom) NOT BETWEEN -90 AND 90);

-- === NOT NULL ===
-- Non-Option in the Slick models, 0-null in every migrated city. SET NOT NULL is idempotent, so the two big interaction
-- columns (validation_task_interaction.timestamp, audit_task_interaction_small.mission_id) can be pre-set by hand on
-- the largest cities off-peak (to schedule their validation-scan lock) before this evolution reaches them.
ALTER TABLE audit_task ALTER COLUMN start_point_reversed SET NOT NULL;
ALTER TABLE config ALTER COLUMN make_crops SET NOT NULL;
ALTER TABLE config ALTER COLUMN excluded_tags SET NOT NULL;
ALTER TABLE pano_data ALTER COLUMN source SET NOT NULL;
ALTER TABLE region_completion ALTER COLUMN total_distance SET NOT NULL;
ALTER TABLE region_completion ALTER COLUMN audited_distance SET NOT NULL;
ALTER TABLE street_edge ALTER COLUMN way_type SET NOT NULL;
ALTER TABLE street_edge ALTER COLUMN timestamp SET NOT NULL;
ALTER TABLE user_current_region ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_current_region ALTER COLUMN region_id SET NOT NULL;
ALTER TABLE user_survey_option_submission ALTER COLUMN time_submitted SET NOT NULL;
ALTER TABLE user_survey_option_submission ALTER COLUMN num_missions_completed SET NOT NULL;
ALTER TABLE user_survey_text_submission ALTER COLUMN time_submitted SET NOT NULL;
ALTER TABLE user_survey_text_submission ALTER COLUMN num_missions_completed SET NOT NULL;
ALTER TABLE validation_task_interaction ALTER COLUMN timestamp SET NOT NULL;
ALTER TABLE audit_task_interaction_small ALTER COLUMN mission_id SET NOT NULL;

-- === UNIQUE (natural keys / one-to-one relationships the app assumes but never enforced) ===
ALTER TABLE street_edge_priority ADD CONSTRAINT street_edge_priority_street_edge_id_key UNIQUE (street_edge_id);
ALTER TABLE street_edge_region ADD CONSTRAINT street_edge_region_street_edge_id_key UNIQUE (street_edge_id);
ALTER TABLE osm_way_street_edge ADD CONSTRAINT osm_way_street_edge_street_edge_id_key UNIQUE (street_edge_id);
ALTER TABLE label_ai_info ADD CONSTRAINT label_ai_info_label_id_key UNIQUE (label_id);
ALTER TABLE user_team ADD CONSTRAINT user_team_user_id_key UNIQUE (user_id);
ALTER TABLE audit_task_user_route ADD CONSTRAINT audit_task_user_route_audit_task_id_key UNIQUE (audit_task_id);
ALTER TABLE route_street ADD CONSTRAINT route_street_route_id_street_edge_id_key UNIQUE (route_id, street_edge_id);
ALTER TABLE user_current_region ADD CONSTRAINT user_current_region_user_id_key UNIQUE (user_id);
ALTER TABLE label_point ADD CONSTRAINT label_point_label_id_key UNIQUE (label_id);

-- === PRIMARY KEY (tables that had none) ===
ALTER TABLE old_label_metadata ADD CONSTRAINT old_label_metadata_pkey PRIMARY KEY (label_id);
-- Matches insertIfNew's (pano_id, location_curr_pano_id) dedup key, making the check-then-insert race-safe.
ALTER TABLE pano_history ADD CONSTRAINT pano_history_pkey PRIMARY KEY (pano_id, location_curr_pano_id);
-- gallery_task_interaction and validation_task_interaction each have a serial id the Slick model already marks
-- O.PrimaryKey, but the table was created without the constraint. gallery_task_interaction is small, so a plain add.
ALTER TABLE gallery_task_interaction ADD CONSTRAINT gallery_task_interaction_pkey PRIMARY KEY (gallery_task_interaction_id);
-- validation_task_interaction is one of the two largest tables, so a plain ADD PRIMARY KEY would build its unique index
-- under an ACCESS EXCLUSIVE lock. Instead build (or reuse) the index first, then promote it -- the promotion is a fast
-- metadata step. To skip the lock entirely on the big cities, pre-create the index BY HAND off-peak -- CONCURRENTLY
-- can't run inside the evolution's transaction, so it stays out of here, and the CREATE ... IF NOT EXISTS below no-ops:
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS validation_task_interaction_pkey ON validation_task_interaction (validation_task_interaction_id)
CREATE UNIQUE INDEX IF NOT EXISTS validation_task_interaction_pkey ON validation_task_interaction (validation_task_interaction_id);
ALTER TABLE validation_task_interaction ADD CONSTRAINT validation_task_interaction_pkey PRIMARY KEY USING INDEX validation_task_interaction_pkey;

-- === Single-row guard for the per-city config table (a constant-expression unique index caps it at one row). ===
CREATE UNIQUE INDEX config_singleton ON config ((TRUE));

-- === CHECK ===
-- Severity is a 1-3 scale, nullable where unset.
ALTER TABLE label ADD CONSTRAINT label_severity_check CHECK (severity IS NULL OR severity BETWEEN 1 AND 3);
ALTER TABLE cluster ADD CONSTRAINT cluster_severity_check CHECK (severity IS NULL OR severity BETWEEN 1 AND 3);
ALTER TABLE label_history ADD CONSTRAINT label_history_severity_check CHECK (severity IS NULL OR severity BETWEEN 1 AND 3);
ALTER TABLE label_validation ADD CONSTRAINT label_validation_old_severity_check CHECK (old_severity IS NULL OR old_severity BETWEEN 1 AND 3);
ALTER TABLE label_validation ADD CONSTRAINT label_validation_new_severity_check CHECK (new_severity IS NULL OR new_severity BETWEEN 1 AND 3);
-- Vote tallies, audited distance, and label density are never negative, and accuracy is a 0-1 fraction.
ALTER TABLE label ADD CONSTRAINT label_counts_nonneg_check CHECK (agree_count >= 0 AND disagree_count >= 0 AND unsure_count >= 0);
ALTER TABLE user_stat ADD CONSTRAINT user_stat_nonneg_check CHECK (meters_audited >= 0 AND own_labels_validated >= 0 AND (labels_per_meter IS NULL OR labels_per_meter >= 0));
ALTER TABLE user_stat ADD CONSTRAINT user_stat_accuracy_check CHECK (accuracy IS NULL OR accuracy BETWEEN 0 AND 1);
-- Coordinates must be geographically valid.
ALTER TABLE label_point ADD CONSTRAINT label_point_lat_lng_check CHECK ((lat IS NULL OR lat BETWEEN -90 AND 90) AND (lng IS NULL OR lng BETWEEN -180 AND 180));
ALTER TABLE pano_data ADD CONSTRAINT pano_data_lat_lng_check CHECK ((lat IS NULL OR lat BETWEEN -90 AND 90) AND (lng IS NULL OR lng BETWEEN -180 AND 180));

# --- !Downs
-- CHECK.
ALTER TABLE pano_data DROP CONSTRAINT IF EXISTS pano_data_lat_lng_check;
ALTER TABLE label_point DROP CONSTRAINT IF EXISTS label_point_lat_lng_check;
ALTER TABLE user_stat DROP CONSTRAINT IF EXISTS user_stat_accuracy_check;
ALTER TABLE user_stat DROP CONSTRAINT IF EXISTS user_stat_nonneg_check;
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_counts_nonneg_check;
ALTER TABLE label_validation DROP CONSTRAINT IF EXISTS label_validation_new_severity_check;
ALTER TABLE label_validation DROP CONSTRAINT IF EXISTS label_validation_old_severity_check;
ALTER TABLE label_history DROP CONSTRAINT IF EXISTS label_history_severity_check;
ALTER TABLE cluster DROP CONSTRAINT IF EXISTS cluster_severity_check;
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_severity_check;

-- Single-row guard.
DROP INDEX IF EXISTS config_singleton;

-- PRIMARY KEY. Dropping the validation_task_interaction PK also drops its underlying index.
ALTER TABLE validation_task_interaction DROP CONSTRAINT IF EXISTS validation_task_interaction_pkey;
ALTER TABLE gallery_task_interaction DROP CONSTRAINT IF EXISTS gallery_task_interaction_pkey;
ALTER TABLE pano_history DROP CONSTRAINT IF EXISTS pano_history_pkey;
ALTER TABLE old_label_metadata DROP CONSTRAINT IF EXISTS old_label_metadata_pkey;

-- UNIQUE.
ALTER TABLE label_point DROP CONSTRAINT IF EXISTS label_point_label_id_key;
ALTER TABLE user_current_region DROP CONSTRAINT IF EXISTS user_current_region_user_id_key;
ALTER TABLE route_street DROP CONSTRAINT IF EXISTS route_street_route_id_street_edge_id_key;
ALTER TABLE audit_task_user_route DROP CONSTRAINT IF EXISTS audit_task_user_route_audit_task_id_key;
ALTER TABLE user_team DROP CONSTRAINT IF EXISTS user_team_user_id_key;
ALTER TABLE label_ai_info DROP CONSTRAINT IF EXISTS label_ai_info_label_id_key;
ALTER TABLE osm_way_street_edge DROP CONSTRAINT IF EXISTS osm_way_street_edge_street_edge_id_key;
ALTER TABLE street_edge_region DROP CONSTRAINT IF EXISTS street_edge_region_street_edge_id_key;
ALTER TABLE street_edge_priority DROP CONSTRAINT IF EXISTS street_edge_priority_street_edge_id_key;

-- NOT NULL. The dedup DELETEs and the corrupt-geom UPDATE above are data changes and are not restored on rollback.
ALTER TABLE audit_task_interaction_small ALTER COLUMN mission_id DROP NOT NULL;
ALTER TABLE validation_task_interaction ALTER COLUMN timestamp DROP NOT NULL;
ALTER TABLE user_survey_text_submission ALTER COLUMN num_missions_completed DROP NOT NULL;
ALTER TABLE user_survey_text_submission ALTER COLUMN time_submitted DROP NOT NULL;
ALTER TABLE user_survey_option_submission ALTER COLUMN num_missions_completed DROP NOT NULL;
ALTER TABLE user_survey_option_submission ALTER COLUMN time_submitted DROP NOT NULL;
ALTER TABLE user_current_region ALTER COLUMN region_id DROP NOT NULL;
ALTER TABLE user_current_region ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE street_edge ALTER COLUMN timestamp DROP NOT NULL;
ALTER TABLE street_edge ALTER COLUMN way_type DROP NOT NULL;
ALTER TABLE region_completion ALTER COLUMN audited_distance DROP NOT NULL;
ALTER TABLE region_completion ALTER COLUMN total_distance DROP NOT NULL;
ALTER TABLE pano_data ALTER COLUMN source DROP NOT NULL;
ALTER TABLE config ALTER COLUMN excluded_tags DROP NOT NULL;
ALTER TABLE config ALTER COLUMN make_crops DROP NOT NULL;
ALTER TABLE audit_task ALTER COLUMN start_point_reversed DROP NOT NULL;
