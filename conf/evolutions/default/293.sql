# --- !Ups
ALTER TABLE label_point ALTER COLUMN zoom TYPE DOUBLE PRECISION;
ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE DOUBLE PRECISION;

-- User-provided imagery might not have copyright info, so let's let the column be nullable.
ALTER TABLE gsv_data ALTER COLUMN copyright DROP NOT NULL;
UPDATE gsv_data SET copyright = NULL WHERE copyright = '';

-- Similarly, non-GSV imagery might not have a "description" field for the links.
ALTER TABLE gsv_link ALTER COLUMN description DROP NOT NULL;
UPDATE gsv_link SET description = NULL WHERE description = '';

-- Some dbs have a pano id that's an empty string. I fixed the front-end code that can create that, so I'm removing any
-- possible references to it here. I didn't find any instances it was being referenced outside of gsv_data, but adding
-- these delete statements to be safe.
DELETE FROM gsv_data CASCADE WHERE gsv_panorama_id = '';
DELETE FROM audit_task_comment CASCADE WHERE gsv_panorama_id = '';
DELETE FROM audit_task_interaction CASCADE WHERE gsv_panorama_id = '';
DELETE FROM audit_task_interaction_small CASCADE WHERE gsv_panorama_id = '';
DELETE FROM gallery_task_interaction CASCADE WHERE pano_id = '';
DELETE FROM gsv_link CASCADE WHERE gsv_panorama_id = '';
DELETE FROM label CASCADE WHERE gsv_panorama_id = '';
DELETE FROM pano_history CASCADE WHERE location_curr_pano_id = '';
DELETE FROM validation_task_comment CASCADE WHERE gsv_panorama_id = '';
DELETE FROM validation_task_interaction CASCADE WHERE gsv_panorama_id = '';

# --- !Downs
UPDATE gsv_link SET description = '' WHERE description IS NULL;
ALTER TABLE gsv_link ALTER COLUMN description SET NOT NULL;

UPDATE gsv_data SET copyright = '' WHERE copyright IS NULL;
ALTER TABLE gsv_data ALTER COLUMN copyright SET NOT NULL;

ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
ALTER TABLE label_point ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
