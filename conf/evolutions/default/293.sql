# --- !Ups
ALTER TABLE label_point ALTER COLUMN zoom TYPE DOUBLE PRECISION;
ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE DOUBLE PRECISION;

-- Change specific references to GSV in table/column names to a more generic "pano".
ALTER TABLE gsv_data RENAME TO pano_data;
ALTER TABLE gsv_link RENAME TO pano_link;

ALTER TABLE audit_task_comment RENAME COLUMN gsv_panorama_id TO pano_id;
ALTER TABLE audit_task_interaction RENAME COLUMN gsv_panorama_id TO pano_id;
ALTER TABLE audit_task_interaction_small RENAME COLUMN gsv_panorama_id TO pano_id;
ALTER TABLE label RENAME COLUMN gsv_panorama_id TO pano_id;
ALTER TABLE pano_data RENAME COLUMN gsv_panorama_id TO pano_id;
ALTER TABLE pano_link RENAME COLUMN gsv_panorama_id TO pano_id;
ALTER TABLE pano_link RENAME COLUMN target_panorama_id TO target_pano_id;
ALTER TABLE validation_task_comment RENAME COLUMN gsv_panorama_id TO pano_id;
ALTER TABLE validation_task_interaction RENAME COLUMN gsv_panorama_id TO pano_id;

-- User-provided imagery might not have copyright info, so let's let the column be nullable.
ALTER TABLE pano_data ALTER COLUMN copyright DROP NOT NULL;
UPDATE pano_data SET copyright = NULL WHERE copyright = '';

-- Similarly, non-GSV imagery might not have a "description" field for the links.
ALTER TABLE pano_link ALTER COLUMN description DROP NOT NULL;
UPDATE pano_link SET description = NULL WHERE description = '';

-- Some dbs have a pano id that's an empty string. I fixed the front-end code that can create that, so I'm removing any
-- possible references to it here. I didn't find any instances it was being referenced outside of pano_data, but adding
-- these delete statements to be safe.
DELETE FROM pano_data CASCADE WHERE pano_id = '';
DELETE FROM audit_task_comment CASCADE WHERE pano_id = '';
DELETE FROM audit_task_interaction CASCADE WHERE pano_id = '';
DELETE FROM audit_task_interaction_small CASCADE WHERE pano_id = '';
DELETE FROM gallery_task_interaction CASCADE WHERE pano_id = '';
DELETE FROM pano_link CASCADE WHERE pano_id = '';
DELETE FROM label CASCADE WHERE pano_id = '';
DELETE FROM pano_history CASCADE WHERE location_curr_pano_id = '';
DELETE FROM validation_task_comment CASCADE WHERE pano_id = '';
DELETE FROM validation_task_interaction CASCADE WHERE pano_id = '';

-- Add a new `source` column to the pano_data table to differentiate between different image sources.
ALTER TABLE pano_data ADD COLUMN source TEXT DEFAULT 'gsv';
ALTER TABLE pano_data ALTER COLUMN source DROP DEFAULT;

# --- !Downs
ALTER TABLE pano_data DROP COLUMN source;

UPDATE pano_link SET description = '' WHERE description IS NULL;
ALTER TABLE pano_link ALTER COLUMN description SET NOT NULL;

UPDATE pano_data SET copyright = '' WHERE copyright IS NULL;
ALTER TABLE pano_data ALTER COLUMN copyright SET NOT NULL;

ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
ALTER TABLE label_point ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;

-- Revert changes to from the more generic "pano" back to "gsv".
ALTER TABLE validation_task_interaction RENAME COLUMN pano_id TO gsv_panorama_id;
ALTER TABLE validation_task_comment RENAME COLUMN pano_id TO gsv_panorama_id;
ALTER TABLE pano_link RENAME COLUMN target_pano_id TO target_panorama_id;
ALTER TABLE pano_link RENAME COLUMN pano_id TO gsv_panorama_id;
ALTER TABLE pano_data RENAME COLUMN pano_id TO gsv_panorama_id;
ALTER TABLE label RENAME COLUMN pano_id TO gsv_panorama_id;
ALTER TABLE audit_task_interaction_small RENAME COLUMN pano_id TO gsv_panorama_id;
ALTER TABLE audit_task_interaction RENAME COLUMN pano_id TO gsv_panorama_id;
ALTER TABLE audit_task_comment RENAME COLUMN pano_id TO gsv_panorama_id;

ALTER TABLE pano_link RENAME TO gsv_link;
ALTER TABLE pano_data RENAME TO gsv_data;
