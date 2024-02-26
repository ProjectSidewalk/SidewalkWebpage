# --- !Ups
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 67, label_type_id, 'hard to reach button' FROM label_type WHERE label_type.label_type = 'Signal';

-- Add "APS" tag back to Chicago server by removing from list of excluded tags.
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "APS"', '') WHERE CURRENT_SCHEMA = 'sidewalk_chicago';

-- Hide "button waist height" tag everyone, since it is being replaced by "hard to reach button".
UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "button waist height"]');

# --- !Downs
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "button waist height"', '');

UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "APS"]') WHERE CURRENT_SCHEMA = 'sidewalk_chicago';

DELETE FROM label_tag
    USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
  AND tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Signal'
  AND tag.tag = 'hard to reach button';

DELETE FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Signal'
  AND tag.tag = 'hard to reach button';
