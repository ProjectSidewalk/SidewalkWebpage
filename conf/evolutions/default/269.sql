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


# --- !Downs
-- Backfill the table with some reasonable defaults.
ALTER TABLE config
    ADD COLUMN api_attribute_center_lat DOUBLE PRECISION NOT NULL DEFAULT city_center_lat,
    ADD COLUMN api_attribute_center_lng DOUBLE PRECISION NOT NULL DEFAULT city_center_lng,
    ADD COLUMN api_attribute_zoom INTEGER NOT NULL DEFAULT default_map_zoom + 2,
    ADD COLUMN api_attribute_lat1 DOUBLE PRECISION NOT NULL DEFAULT city_center_lat - 0.01,
    ADD COLUMN api_attribute_lng1 DOUBLE PRECISION NOT NULL DEFAULT city_center_lng - 0.01,
    ADD COLUMN api_attribute_lat2 DOUBLE PRECISION NOT NULL DEFAULT city_center_lat + 0.01,
    ADD COLUMN api_attribute_lng2 DOUBLE PRECISION NOT NULL DEFAULT city_center_lng + 0.01,
    ADD COLUMN api_street_center_lat DOUBLE PRECISION NOT NULL DEFAULT city_center_lat,
    ADD COLUMN api_street_center_lng DOUBLE PRECISION NOT NULL DEFAULT city_center_lng,
    ADD COLUMN api_street_zoom INTEGER NOT NULL DEFAULT default_map_zoom + 2,
    ADD COLUMN api_street_lat1 DOUBLE PRECISION NOT NULL DEFAULT city_center_lat - 0.01,
    ADD COLUMN api_street_lng1 DOUBLE PRECISION NOT NULL DEFAULT city_center_lng - 0.01,
    ADD COLUMN api_street_lat2 DOUBLE PRECISION NOT NULL DEFAULT city_center_lat + 0.01,
    ADD COLUMN api_street_lng2 DOUBLE PRECISION NOT NULL DEFAULT city_center_lng + 0.01,
    ADD COLUMN api_region_center_lat DOUBLE PRECISION NOT NULL DEFAULT city_center_lat,
    ADD COLUMN api_region_center_lng DOUBLE PRECISION NOT NULL DEFAULT city_center_lng,
    ADD COLUMN api_region_zoom INTEGER NOT NULL DEFAULT default_map_zoom + 2,
    ADD COLUMN api_region_lat1 DOUBLE PRECISION NOT NULL DEFAULT city_center_lat - 0.02,
    ADD COLUMN api_region_lng1 DOUBLE PRECISION NOT NULL DEFAULT city_center_lng - 0.02,
    ADD COLUMN api_region_lat2 DOUBLE PRECISION NOT NULL DEFAULT city_center_lat + 0.02,
    ADD COLUMN api_region_lng2 DOUBLE PRECISION NOT NULL DEFAULT city_center_lng + 0.02;

-- Not bother to add back the descriptions since they weren't any good anyway.
ALTER TABLE label_type ADD COLUMN description TEXT;

ALTER TABLE user_attribute ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE global_attribute ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX idx_region_geom;
DROP INDEX idx_street_edge_geom;

ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_pkey;
