# --- !Ups
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

-- Add a few missing indices.
CREATE INDEX label_pano_id_idx ON label (pano_id);
CREATE INDEX validation_task_comment_pano_id_idx ON validation_task_comment (pano_id);

-- Update any index names (fixing some that have gotten out of sync in the past as well).
ALTER INDEX idx_cluster_geom RENAME TO cluster_geom_idx;
ALTER INDEX audit_task_comment_gsv_panorama_id_idx RENAME TO audit_task_comment_pano_id_idx;
DROP INDEX index_audit_task_incomplete_id; -- This one is redundant with primary key.
ALTER INDEX gsv_link_gsv_panorama_id_idx RENAME TO pano_link_pano_id_idx;
ALTER INDEX gsv_link_target_panorama_id_idx RENAME TO pano_link_target_pano_id_idx;
ALTER INDEX idx_region_geom RENAME TO region_geom_idx;
ALTER INDEX idx_street_edge_geom RENAME TO street_edge_geom_idx;

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
CREATE TYPE pano_source AS ENUM ('gsv', 'mapillary', 'infra3d');
ALTER TABLE pano_data ADD COLUMN source pano_source DEFAULT 'gsv';
ALTER TABLE pano_data ALTER COLUMN source DROP DEFAULT;

-- Make the same fix as in 279.sql that was missed in the label_history table.
UPDATE label_history SET source = 'Validate' WHERE source = 'ValidateDesktop';
UPDATE label_history SET source = 'AdminValidate' WHERE source = 'ValidateDesktopAdmin';
UPDATE label_history SET source = 'ExpertValidate' WHERE source = 'ValidateDesktopNew';

-- Turn some other columns that should be enums into enums.
CREATE TYPE ui_source AS ENUM (
    'Explore', 'Validate', 'ExpertValidate', 'ValidateMobile', 'AdminValidate', 'LabelMap', 'GalleryImage',
    'GalleryExpandedImage', 'GalleryThumbs', 'GalleryExpandedThumbs', 'UserMap', 'LabelSearchPage',
    'AdminUserDashboard', 'AdminMapTab', 'AdminContributionsTab', 'AdminLabelSearchTab', 'SidewalkAI',
    'ExternalTagValidationASSETS2024', 'Old data, unknown source'
);
ALTER TABLE label_history ALTER COLUMN source TYPE ui_source USING source::ui_source;
ALTER TABLE label_validation ALTER COLUMN source TYPE ui_source USING source::ui_source;
ALTER TABLE validation_task_interaction ALTER COLUMN source TYPE ui_source USING source::ui_source;

-- Fix the nullable columns in audit_task_comment that aren't ever actually null. Adding delete statement for safety.
DELETE FROM audit_task_comment WHERE heading IS NULL OR pitch IS NULL OR zoom IS NULL OR pano_id IS NULL;
ALTER TABLE audit_task_comment
    ALTER COLUMN heading SET NOT NULL,
    ALTER COLUMN pitch SET NOT NULL,
    ALTER COLUMN zoom SET NOT NULL,
    ALTER COLUMN pano_id SET NOT NULL;

-- Make it so that zoom columns are all Doubles instead of Ints.
ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE DOUBLE PRECISION;
ALTER TABLE audit_task_interaction_small ALTER COLUMN zoom TYPE DOUBLE PRECISION;
ALTER TABLE audit_task_comment ALTER COLUMN zoom TYPE DOUBLE PRECISION;
ALTER TABLE label_point ALTER COLUMN zoom TYPE DOUBLE PRECISION;
ALTER TABLE validation_task_comment ALTER COLUMN zoom TYPE DOUBLE PRECISION;

-- Remove the audit_task_incomplete table. Set completed=true and incomplete=true in audit_task to get same outcome.
UPDATE audit_task
SET completed = true, incomplete = true
FROM audit_task_incomplete
WHERE audit_task.audit_task_id = audit_task_incomplete.audit_task_id
  AND audit_task.completed = FALSE
  AND audit_task_incomplete.issue_description = 'IWantToExplore';
DROP TABLE audit_task_incomplete;

# --- !Downs
-- Adds the audit_task_incomplete table back in. Though we don't have a way to get the data back into it.
CREATE TABLE IF NOT EXISTS audit_task_incomplete (
    audit_task_incomplete_id SERIAL PRIMARY KEY,
    issue_description TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    audit_task_id INT NOT NULL,
    mission_id INT NOT NULL,
    FOREIGN KEY (audit_task_id) REFERENCES audit_task (audit_task_id),
    FOREIGN KEY (mission_id) REFERENCES mission (mission_id)
);
ALTER TABLE audit_task_incomplete OWNER TO sidewalk;

-- Set zoom back to an integer where it was before.
ALTER TABLE validation_task_comment ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
ALTER TABLE label_point ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
ALTER TABLE audit_task_comment ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
ALTER TABLE audit_task_interaction_small ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;
ALTER TABLE audit_task_interaction ALTER COLUMN zoom TYPE INTEGER USING round(zoom)::integer;

-- Make columns nullable again in audit_task_comment.
ALTER TABLE audit_task_comment
    ALTER COLUMN pano_id DROP NOT NULL,
    ALTER COLUMN zoom DROP NOT NULL,
    ALTER COLUMN pitch DROP NOT NULL,
    ALTER COLUMN heading DROP NOT NULL;

ALTER TABLE pano_data DROP COLUMN source;
DROP TYPE pano_source;

ALTER TABLE label_history ALTER COLUMN source TYPE TEXT USING source::TEXT;
ALTER TABLE label_validation ALTER COLUMN source TYPE TEXT USING source::TEXT;
ALTER TABLE validation_task_interaction ALTER COLUMN source TYPE TEXT USING source::TEXT;
DROP TYPE ui_source;

UPDATE label_history SET source = 'ValidateDesktopNew' WHERE source = 'ExpertValidate';
UPDATE label_history SET source = 'ValidateDesktopAdmin' WHERE source = 'AdminValidate';
UPDATE label_history SET source = 'ValidateDesktop' WHERE source = 'Validate';

UPDATE pano_link SET description = '' WHERE description IS NULL;
ALTER TABLE pano_link ALTER COLUMN description SET NOT NULL;

UPDATE pano_data SET copyright = '' WHERE copyright IS NULL;
ALTER TABLE pano_data ALTER COLUMN copyright SET NOT NULL;

-- Revert changes to from the more generic "pano" back to "gsv".
ALTER INDEX street_edge_geom_idx RENAME TO idx_street_edge_geom;
ALTER INDEX region_geom_idx RENAME TO idx_region_geom;
ALTER INDEX pano_link_target_pano_id_idx RENAME TO gsv_link_target_panorama_id_idx;
ALTER INDEX pano_link_pano_id_idx RENAME TO gsv_link_gsv_panorama_id_idx;
CREATE INDEX index_audit_task_incomplete_id ON audit_task_incomplete (audit_task_incomplete_id);
ALTER INDEX audit_task_comment_pano_id_idx RENAME TO audit_task_comment_gsv_panorama_id_idx;
ALTER INDEX cluster_geom_idx RENAME TO idx_cluster_geom;

DROP INDEX validation_task_comment_pano_id_idx;
DROP INDEX label_pano_id_idx;

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
