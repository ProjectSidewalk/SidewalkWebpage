# --- !Ups
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 65, label_type_id, 'outdoor dining area' FROM label_type WHERE label_type.label_type = 'Obstacle';

UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "outdoor dining area"]') WHERE current_database() != 'sidewalk-zurich';

# --- !Downs
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "outdoor dining area"', '');

DELETE FROM label_tag
    USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
  AND tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Obstacle'
  AND tag.tag IN ('outdoor dining area');

DELETE FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Obstacle'
  AND tag.tag IN ('outdoor dining area');