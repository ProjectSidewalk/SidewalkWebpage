# --- !Ups
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 67, label_type_id, 'one button' FROM label_type WHERE label_type.label_type = 'Signal';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 68, label_type_id, 'two buttons' FROM label_type WHERE label_type.label_type = 'Signal';
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 69, label_type_id, 'hard to reach buttons' FROM label_type WHERE label_type.label_type = 'Signal';

-- Turn all the "has button" tags into "one button" so we aren't throwing away all that info.
UPDATE label_tag SET tag_id = 67 WHERE tag_id = (SELECT tag_id FROM tag WHERE tag = 'has button');

-- Then delete the old "has button" tag.
DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Signal'
    AND tag.tag = 'has button';

-- Add "APS" tag back all servers by removing from list of excluded tags.
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "APS"', '');

-- Hide "button waist height" tag everywhere, since it is being replaced by "hard to reach buttons".
UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "button waist height"]') WHERE excluded_tags NOT LIKE '%button waist height%';

-- Hide "has button" tag everywhere, since it is being replaced by "one button" and "two buttons".
UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "has button"]') WHERE excluded_tags NOT LIKE '%has button%';

# --- !Downs
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "has button"', '');

UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "button waist height"', '');

UPDATE config SET excluded_tags = REPLACE(excluded_tags, '"]', '" "APS"]') WHERE excluded_tags NOT LIKE '%APS%';

-- Add back the "has button" tag.
INSERT INTO tag (tag_id, label_type_id, tag) SELECT 42, label_type_id, 'has button' FROM label_type WHERE label_type.label_type = 'Signal';

-- Set any tags related to number of buttons to just "has button".
UPDATE label_tag SET tag_id = 42 WHERE tag_id IN (67, 68);

DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Signal'
    AND tag.tag IN ('hard to reach buttons', 'one button', 'two buttons');

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Signal'
    AND tag.tag IN ('hard to reach buttons', 'one button', 'two buttons');
