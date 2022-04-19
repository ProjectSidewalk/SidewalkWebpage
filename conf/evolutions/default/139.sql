# --- !Ups
-- Add 'no pedestrian priority' tag for Crosswalk.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 54, label_type_id, 'no pedestrian priority' FROM label_type WHERE label_type.label_type = 'Crosswalk';

-- Add 'tactile warning' tag for CurbRamp.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 55, label_type_id, 'tactile warning' FROM label_type WHERE label_type.label_type = 'CurbRamp';

# --- !Downs
-- Remove 'no pedestrian priority' tag for Crosswalk.
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
