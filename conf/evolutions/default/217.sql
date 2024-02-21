# --- !Ups
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 67, label_type_id, 'one button' FROM label_type WHERE label_type.label_type = 'Signal';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 68, label_type_id, 'two buttons' FROM label_type WHERE label_type.label_type = 'Signal';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 69, label_type_id, 'one walk light' FROM label_type WHERE label_type.label_type = 'Signal';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 70, label_type_id, 'two walk lights' FROM label_type WHERE label_type.label_type = 'Signal';

UPDATE label_tag SET tag_id = 67 WHERE tag_id = (SELECT tag_id FROM tag WHERE tag = 'has button');

UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "has button"]');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "APS"', '') WHERE CURRENT_SCHEMA = 'sidewalk_chicago';

# --- !Downs
UPDATE config SET excluded_tags = REPLACE(excluded_tags, '', ' "has button"');

-- Set any tags related to buttons to just "has button".
UPDATE label_tag SET tag_id = (SELECT tag_id FROM tag WHERE tag = 'has button') WHERE tag_id IN (67, 68);

DELETE FROM label_tag
    USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
  AND tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Signal'
  AND tag.tag IN ('one button', 'two buttons', 'one walk light', 'two walk lights');

DELETE FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Signal'
  AND tag.tag IN ('one button', 'two buttons', 'one walk light', 'two walk lights');
