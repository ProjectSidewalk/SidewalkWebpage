# --- !Ups
-- Add 'no pedestrian priority' tag for Crosswalk and 'tactile warning' tag for CurbRamp.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 54, label_type_id, 'no pedestrian priority' FROM label_type WHERE label_type.label_type = 'Crosswalk';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 55, label_type_id, 'tactile warning' FROM label_type WHERE label_type.label_type = 'CurbRamp';

-- Rename 'missing friction strip' to 'missing tactile warning'.
UPDATE tag SET tag = 'missing tactile warning' WHERE tag = 'missing friction strip';

-- Rename in logs as well. We check the `action` column in the `audit_task_interaction` table so we don't overwrite user-input descriptions.
UPDATE gallery_task_interaction SET note = REPLACE(note, 'missing friction strip', 'missing tactile warning') WHERE note LIKE '%missing friction strip%';

UPDATE audit_task_interaction
SET note = REPLACE(note, 'missing friction strip', 'missing tactile warning')
WHERE action IN ('ContextMenu_TagAdded', 'ContextMenu_TagRemoved', 'KeyboardShortcut_TagAdded', 'KeyboardShortcut_TagRemoved')
    AND note LIKE '%missing friction strip%';

# --- !Downs
-- Rename 'missing tactile warning' to 'missing friction strip'. Including in logs.
UPDATE audit_task_interaction
SET note = REPLACE(note, 'missing tactile warning', 'missing friction strip')
WHERE action IN ('ContextMenu_TagAdded', 'ContextMenu_TagRemoved', 'KeyboardShortcut_TagAdded', 'KeyboardShortcut_TagRemoved')
    AND note LIKE '%missing friction strip%';

UPDATE gallery_task_interaction SET note = REPLACE(note, 'missing tactile warning', 'missing friction strip') WHERE note LIKE '%missing friction strip%';

UPDATE tag SET tag = 'missing friction strip' WHERE tag = 'missing tactile warning';

-- Remove 'no pedestrian priority' tag for Crosswalk and 'tactile warning' tag for CurbRamp.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND (
        (label_type.label_type = 'Crosswalk' AND tag.tag = 'no pedestrian priority')
        OR (label_type.label_type = 'CurbRamp' AND tag.tag = 'tactile warning')
    );

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND (
        (label_type.label_type = 'Crosswalk' AND tag.tag = 'no pedestrian priority')
        OR (label_type.label_type = 'CurbRamp' AND tag.tag = 'tactile warning')
    );
