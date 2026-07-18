# --- !Ups
-- Convert mission.mission_type_id from an int FK into a mission_type enum (#4103). The mission_type lookup table must
-- be dropped before CREATE TYPE, since tables and types share a namespace. The id -> name mapping is taken from each
-- schema's own mission_type table (via a temp column, since USING can't hold a subquery) rather than hardcoding the
-- canonical ids, because some prod schemas' lookup rows have drifted from them. A mission whose resolved name isn't
-- one of the enum's values fails the cast loudly rather than being silently mislabeled.
ALTER TABLE mission DROP CONSTRAINT mission_mission_type_id_fkey;
ALTER TABLE mission ADD COLUMN mission_type_name TEXT;
UPDATE mission
SET mission_type_name = mission_type.mission_type
FROM mission_type
WHERE mission.mission_type_id = mission_type.mission_type_id;
DROP TABLE mission_type;
CREATE TYPE mission_type AS ENUM
  ('auditOnboarding', 'audit', 'validationOnboarding', 'validation', 'cvGroundTruth', 'labelmapValidation', 'aiValidation');
ALTER TABLE mission
  ALTER COLUMN mission_type_id TYPE mission_type
  USING mission_type_name::mission_type;
ALTER TABLE mission DROP COLUMN mission_type_name;
ALTER TABLE mission RENAME COLUMN mission_type_id TO mission_type;
-- IF EXISTS because a few old, no-longer-deployed schemas never got this index.
ALTER INDEX IF EXISTS mission_mission_type_id_idx RENAME TO mission_mission_type_idx;

-- Convert street_edge.way_type from text into an enum (#4103). The value set is the union of our usual city-import
-- whitelist and the broader OSM highway set that CDMX was imported with. fill-new-schema.sh casts the imported
-- column, so a value outside this set fails a future import loudly (and gets an ALTER TYPE ... ADD VALUE evolution).
-- Streets from non-OSM imports (Infra3d) carry no OSM way type and historically stored '' -- those become 'unknown'.
CREATE TYPE way_type AS ENUM
  ('motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
   'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'pedestrian', 'service', 'road',
   'track', 'raceway', 'footway', 'cycleway', 'path', 'bridleway', 'steps', 'corridor', 'crossing', 'construction',
   'border', 'subway', 'unknown');
UPDATE street_edge SET way_type = 'unknown' WHERE way_type = '';
ALTER TABLE street_edge ALTER COLUMN way_type TYPE way_type USING way_type::way_type;

-- Convert label_point.computation_method from text into an enum (#4103). Stays nullable (old labels predate it).
CREATE TYPE computation_method AS ENUM ('depth', 'approximation2');
ALTER TABLE label_point
  ALTER COLUMN computation_method TYPE computation_method USING computation_method::computation_method;

-- Convert street_edge_issue.issue from text into an enum (#4103). First backfill the rows that the old
-- GSVNotAvailable -> PanoNotAvailable rename forgot.
UPDATE street_edge_issue SET issue = 'PanoNotAvailable' WHERE issue = 'GSVNotAvailable';
CREATE TYPE street_edge_issue_type AS ENUM ('PanoNotAvailable');
ALTER TABLE street_edge_issue ALTER COLUMN issue TYPE street_edge_issue_type USING issue::street_edge_issue_type;

-- Closed value sets on tiny script-seeded config/cache tables get plain CHECKs rather than enum types (#4103).
ALTER TABLE config ADD CONSTRAINT config_open_status_check CHECK (open_status IN ('fully', 'partially'));
ALTER TABLE funnel_stat ADD CONSTRAINT funnel_stat_funnel_type_check CHECK (funnel_type IN ('mapping', 'contribution'));
ALTER TABLE funnel_stat ADD CONSTRAINT funnel_stat_time_window_check CHECK (time_window IN ('30d', '90d', 'all'));
ALTER TABLE survey_question ADD CONSTRAINT survey_question_survey_input_type_check
  CHECK (survey_input_type IN ('radio', 'checkbox', 'free-text-feedback'));

# --- !Downs
ALTER TABLE survey_question DROP CONSTRAINT survey_question_survey_input_type_check;
ALTER TABLE funnel_stat DROP CONSTRAINT funnel_stat_time_window_check;
ALTER TABLE funnel_stat DROP CONSTRAINT funnel_stat_funnel_type_check;
ALTER TABLE config DROP CONSTRAINT config_open_status_check;

-- The GSVNotAvailable backfill is deliberately not reversed: PanoNotAvailable was already the correct current name.
ALTER TABLE street_edge_issue ALTER COLUMN issue TYPE TEXT USING issue::text;
DROP TYPE street_edge_issue_type;

ALTER TABLE label_point ALTER COLUMN computation_method TYPE TEXT USING computation_method::text;
DROP TYPE computation_method;

-- The '' -> 'unknown' backfill is deliberately not reversed: 'unknown' is the more meaningful value either way.
ALTER TABLE street_edge ALTER COLUMN way_type TYPE TEXT USING way_type::text;
DROP TYPE way_type;

ALTER INDEX IF EXISTS mission_mission_type_idx RENAME TO mission_mission_type_id_idx;
ALTER TABLE mission RENAME COLUMN mission_type TO mission_type_id;
ALTER TABLE mission
  ALTER COLUMN mission_type_id TYPE INT
  USING (CASE mission_type_id
    WHEN 'auditOnboarding' THEN 1
    WHEN 'audit' THEN 2
    WHEN 'validationOnboarding' THEN 3
    WHEN 'validation' THEN 4
    WHEN 'cvGroundTruth' THEN 5
    WHEN 'labelmapValidation' THEN 6
    WHEN 'aiValidation' THEN 7
  END);
DROP TYPE mission_type;
CREATE TABLE mission_type (
  mission_type_id SERIAL PRIMARY KEY,
  mission_type TEXT NOT NULL
);
ALTER TABLE mission_type OWNER TO sidewalk;
INSERT INTO mission_type (mission_type)
VALUES ('auditOnboarding'), ('audit'), ('validationOnboarding'), ('validation'), ('cvGroundTruth'),
  ('labelmapValidation'), ('aiValidation');
ALTER TABLE mission ADD CONSTRAINT mission_mission_type_id_fkey
  FOREIGN KEY (mission_type_id) REFERENCES mission_type (mission_type_id);
