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

# --- !Downs
-- Not bother to add back the descriptions since they weren't any good anyway.
ALTER TABLE label_type ADD COLUMN description TEXT;

ALTER TABLE user_attribute ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE global_attribute ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX idx_region_geom;
DROP INDEX idx_street_edge_geom;

ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_pkey;
