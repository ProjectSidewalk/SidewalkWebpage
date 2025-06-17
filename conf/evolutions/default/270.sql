# --- !Ups
-- Adds user_id as the primary key to the auth_tokens table. It has been treated as such, but was missing in the db.
ALTER TABLE auth_tokens ADD PRIMARY KEY (user_id);

-- Adds spatial indexes to the street_edge and region tables to speed up spatial queries.
CREATE INDEX idx_street_edge_geom ON street_edge USING GIST(geom);
CREATE INDEX idx_region_geom ON region USING GIST(geom);

-- Fixes the pay column in the mission table, which was erroneously set to a nonzero value for non-turkers for a time.
UPDATE mission
SET pay = 0
FROM user_role
INNER JOIN role ON user_role.role_id = role.role_id
WHERE mission.user_id = user_role.user_id AND role.role <> 'Turker' AND pay > 0;

-- Removes the temporary column from the clustering tables.
ALTER TABLE global_attribute DROP COLUMN IF EXISTS temporary;
ALTER TABLE user_attribute DROP COLUMN IF EXISTS temporary;

-- Removes description column from the label_type table. These have been moved to messages files.
ALTER TABLE label_type DROP COLUMN IF EXISTS description;

-- Removes old API map boundaries from config table.
ALTER TABLE config
    DROP COLUMN IF EXISTS api_attribute_center_lat,
    DROP COLUMN IF EXISTS api_attribute_center_lng,
    DROP COLUMN IF EXISTS api_attribute_zoom,
    DROP COLUMN IF EXISTS api_attribute_lat1,
    DROP COLUMN IF EXISTS api_attribute_lng1,
    DROP COLUMN IF EXISTS api_attribute_lat2,
    DROP COLUMN IF EXISTS api_attribute_lng2,
    DROP COLUMN IF EXISTS api_street_center_lat,
    DROP COLUMN IF EXISTS api_street_center_lng,
    DROP COLUMN IF EXISTS api_street_zoom,
    DROP COLUMN IF EXISTS api_street_lat1,
    DROP COLUMN IF EXISTS api_street_lng1,
    DROP COLUMN IF EXISTS api_street_lat2,
    DROP COLUMN IF EXISTS api_street_lng2,
    DROP COLUMN IF EXISTS api_region_center_lat,
    DROP COLUMN IF EXISTS api_region_center_lng,
    DROP COLUMN IF EXISTS api_region_zoom,
    DROP COLUMN IF EXISTS api_region_lat1,
    DROP COLUMN IF EXISTS api_region_lng1,
    DROP COLUMN IF EXISTS api_region_lat2,
    DROP COLUMN IF EXISTS api_region_lng2;

-- Fixes missing entries in the user_stat table. Code has a fix for all future entries.
INSERT INTO user_stat (user_id, meters_audited, labels_per_meter, high_quality, high_quality_manual, own_labels_validated, accuracy, excluded)
    SELECT DISTINCT webpage_activity.user_id, 0, CAST(NULL AS DOUBLE PRECISION), TRUE, CAST(NULL AS BOOLEAN), 0, CAST(NULL AS DOUBLE PRECISION), FALSE
    FROM webpage_activity
    LEFT JOIN user_stat USING (user_id)
    WHERE user_stat.user_id IS NULL;

-- Now that user_stat entries have been fixed, recalculate the validation counts for all labels.
UPDATE label
SET (agree_count, disagree_count, unsure_count, correct) = (n_agree, n_disagree, n_unsure, is_correct)
FROM (
    SELECT label.label_id,
           COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_agree,
           COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_disagree,
           COUNT(CASE WHEN validation_result = 3 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_unsure,
           CASE
               WHEN COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END)
                   > COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) THEN TRUE
               WHEN COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END)
                   > COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) THEN FALSE
               ELSE NULL
               END AS is_correct
    FROM label
    LEFT JOIN mission ON mission.mission_id = label.mission_id
    LEFT JOIN label_validation ON label.label_id = label_validation.label_id AND mission.user_id <> label_validation.user_id
    LEFT JOIN user_stat ON label_validation.user_id = user_stat.user_id AND user_stat.excluded = FALSE
    GROUP BY label.label_id
) AS validation_count
WHERE label.label_id = validation_count.label_id;

# --- !Downs
-- Backfill the table with some reasonable defaults.
ALTER TABLE config
    ADD COLUMN api_attribute_center_lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN api_attribute_center_lng DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN api_attribute_zoom INTEGER NOT NULL DEFAULT 16,
    ADD COLUMN api_attribute_lat1 DOUBLE PRECISION NOT NULL DEFAULT -0.01,
    ADD COLUMN api_attribute_lng1 DOUBLE PRECISION NOT NULL DEFAULT -0.01,
    ADD COLUMN api_attribute_lat2 DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    ADD COLUMN api_attribute_lng2 DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    ADD COLUMN api_street_center_lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN api_street_center_lng DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN api_street_zoom INTEGER NOT NULL DEFAULT 16,
    ADD COLUMN api_street_lat1 DOUBLE PRECISION NOT NULL DEFAULT -0.01,
    ADD COLUMN api_street_lng1 DOUBLE PRECISION NOT NULL DEFAULT -0.01,
    ADD COLUMN api_street_lat2 DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    ADD COLUMN api_street_lng2 DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    ADD COLUMN api_region_center_lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN api_region_center_lng DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN api_region_zoom INTEGER NOT NULL DEFAULT 16,
    ADD COLUMN api_region_lat1 DOUBLE PRECISION NOT NULL DEFAULT -0.02,
    ADD COLUMN api_region_lng1 DOUBLE PRECISION NOT NULL DEFAULT -0.02,
    ADD COLUMN api_region_lat2 DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    ADD COLUMN api_region_lng2 DOUBLE PRECISION NOT NULL DEFAULT 0.02;

-- Not bother to add back the descriptions since they weren't any good anyway.
ALTER TABLE label_type ADD COLUMN description TEXT;

ALTER TABLE user_attribute ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE global_attribute ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX idx_region_geom;
DROP INDEX idx_street_edge_geom;

ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_pkey;
