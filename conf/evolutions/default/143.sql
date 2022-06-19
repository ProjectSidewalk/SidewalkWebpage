# --- !Ups
-- Add 'pooled water' tag for CurbRamp, 'uncovered manhole' for SurfaceProblem, and 'very long crossing' for Crosswalk.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 56, label_type_id, 'pooled water' FROM label_type WHERE label_type.label_type = 'CurbRamp';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 57, label_type_id, 'uncovered manhole' FROM label_type WHERE label_type.label_type = 'SurfaceProblem';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 58, label_type_id, 'very long crossing' FROM label_type WHERE label_type.label_type = 'Crosswalk';

# --- !Downs
-- Remove 'no pedestrian priority' tag for Crosswalk.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND (
        (label_type.label_type = 'CurbRamp' AND tag.tag = 'pooled water')
        OR (label_type.label_type = 'SurfaceProblem' AND tag.tag = 'uncovered manhole')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'very long crossing')
    );

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND (
        (label_type.label_type = 'CurbRamp' AND tag.tag = 'pooled water')
        OR (label_type.label_type = 'SurfaceProblem' AND tag.tag = 'uncovered manhole')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'very long crossing')
    );
