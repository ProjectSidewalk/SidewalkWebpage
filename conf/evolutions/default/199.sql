# --- !Ups
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 66, label_type_id, 'parallel lines' FROM label_type WHERE label_type.label_type = 'CurbRamp';

UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "parallel lines"]') WHERE current_database() != 'sidewalk-burnaby';

# --- !Downs
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "parallel lines"', '');

DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'CurbRamp'
    AND tag.tag IN ('parallel lines');

DELETE FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'CurbRamp'
  AND tag.tag IN ('parallel lines');
