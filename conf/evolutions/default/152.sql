# --- !Ups
-- Add 'level with sidewalk' tag for Crosswalks.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 59, label_type_id, 'level with sidewalk' FROM label_type WHERE label_type.label_type = 'Crosswalk';

# --- !Downs
-- Remove 'level with sidewalk' tag for Crosswalks.
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag = 'level with sidewalk';

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag = 'level with sidewalk';
