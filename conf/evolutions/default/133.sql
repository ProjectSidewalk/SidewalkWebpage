# --- !Ups
SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from "tag"));

-- Add 'sand/gravel' tag for surface problems.
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'sand/gravel' FROM label_type WHERE label_type.label_type = 'SurfaceProblem';

-- Add 'surface problem' tag for curb ramps.
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'surface problem' FROM label_type WHERE label_type.label_type = 'CurbRamp';

-- Add 'brick', 'bumpy', and 'rail/tram tracks' tags for crosswalks.
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'brick' FROM label_type WHERE label_type.label_type = 'Crosswalk';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'bumpy' FROM label_type WHERE label_type.label_type = 'Crosswalk';
INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'rail/tram track' FROM label_type WHERE label_type.label_type = 'Crosswalk';

# --- !Downs
SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from "tag"));

-- Remove all tags added in the Ups.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND (
        (label_type.label_type = 'SurfaceProblem' AND tag.tag = 'sand/gravel')
        OR (label_type.label_type = 'CurbRamp' AND tag.tag = 'surface problem')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'brick')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'bumpy')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'rail/tram track')
    );

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND (
        (label_type.label_type = 'SurfaceProblem' AND tag.tag = 'sand/gravel')
        OR (label_type.label_type = 'CurbRamp' AND tag.tag = 'surface problem')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'brick')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'bumpy')
        OR (label_type.label_type = 'Crosswalk' AND tag.tag = 'rail/tram track')
    );
