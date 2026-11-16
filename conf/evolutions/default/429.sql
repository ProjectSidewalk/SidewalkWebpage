# --- !Ups
-- Rename the NoSidewalk tag so it reads clearly apart from "street has no sidewalks" (#5919). Tags are stored by name,
-- so every column that keeps a copy of the name gets the new one too. The WHERE clauses keep untouched rows unwritten.
UPDATE tag SET tag = 'other side has a sidewalk' WHERE tag = 'street has a sidewalk';
UPDATE tag SET mutually_exclusive_with = 'other side has a sidewalk'
WHERE mutually_exclusive_with = 'street has a sidewalk';

UPDATE label SET tags = ARRAY_REPLACE(tags, 'street has a sidewalk', 'other side has a sidewalk')
WHERE 'street has a sidewalk' = ANY(tags);

UPDATE label_history SET tags = ARRAY_REPLACE(tags, 'street has a sidewalk', 'other side has a sidewalk')
WHERE 'street has a sidewalk' = ANY(tags);

UPDATE label_edit
SET old_tags = ARRAY_REPLACE(old_tags, 'street has a sidewalk', 'other side has a sidewalk'),
    new_tags = ARRAY_REPLACE(new_tags, 'street has a sidewalk', 'other side has a sidewalk')
WHERE 'street has a sidewalk' = ANY(old_tags) OR 'street has a sidewalk' = ANY(new_tags);

UPDATE voided_label_history SET tags = ARRAY_REPLACE(tags, 'street has a sidewalk', 'other side has a sidewalk')
WHERE 'street has a sidewalk' = ANY(tags);

UPDATE voided_label_validation
SET old_history_tags = ARRAY_REPLACE(old_history_tags, 'street has a sidewalk', 'other side has a sidewalk'),
    old_tags = ARRAY_REPLACE(old_tags, 'street has a sidewalk', 'other side has a sidewalk'),
    new_tags = ARRAY_REPLACE(new_tags, 'street has a sidewalk', 'other side has a sidewalk')
WHERE 'street has a sidewalk' = ANY(old_history_tags)
  OR 'street has a sidewalk' = ANY(old_tags)
  OR 'street has a sidewalk' = ANY(new_tags);

UPDATE config
SET excluded_tags = REPLACE(excluded_tags::text, '"street has a sidewalk"', '"other side has a sidewalk"')::jsonb
WHERE excluded_tags @> '[{"tag": "street has a sidewalk"}]';

# --- !Downs
UPDATE config
SET excluded_tags = REPLACE(excluded_tags::text, '"other side has a sidewalk"', '"street has a sidewalk"')::jsonb
WHERE excluded_tags @> '[{"tag": "other side has a sidewalk"}]';

UPDATE voided_label_validation
SET old_history_tags = ARRAY_REPLACE(old_history_tags, 'other side has a sidewalk', 'street has a sidewalk'),
    old_tags = ARRAY_REPLACE(old_tags, 'other side has a sidewalk', 'street has a sidewalk'),
    new_tags = ARRAY_REPLACE(new_tags, 'other side has a sidewalk', 'street has a sidewalk')
WHERE 'other side has a sidewalk' = ANY(old_history_tags)
  OR 'other side has a sidewalk' = ANY(old_tags)
  OR 'other side has a sidewalk' = ANY(new_tags);

UPDATE voided_label_history SET tags = ARRAY_REPLACE(tags, 'other side has a sidewalk', 'street has a sidewalk')
WHERE 'other side has a sidewalk' = ANY(tags);

UPDATE label_edit
SET old_tags = ARRAY_REPLACE(old_tags, 'other side has a sidewalk', 'street has a sidewalk'),
    new_tags = ARRAY_REPLACE(new_tags, 'other side has a sidewalk', 'street has a sidewalk')
WHERE 'other side has a sidewalk' = ANY(old_tags) OR 'other side has a sidewalk' = ANY(new_tags);

UPDATE label_history SET tags = ARRAY_REPLACE(tags, 'other side has a sidewalk', 'street has a sidewalk')
WHERE 'other side has a sidewalk' = ANY(tags);

UPDATE label SET tags = ARRAY_REPLACE(tags, 'other side has a sidewalk', 'street has a sidewalk')
WHERE 'other side has a sidewalk' = ANY(tags);

UPDATE tag SET mutually_exclusive_with = 'street has a sidewalk'
WHERE mutually_exclusive_with = 'other side has a sidewalk';
UPDATE tag SET tag = 'street has a sidewalk' WHERE tag = 'other side has a sidewalk';
