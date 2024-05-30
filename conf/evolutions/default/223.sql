# --- !Ups
UPDATE tag SET tag = 'debris / pooled water' WHERE tag = 'pooled water';

UPDATE label SET tags = ARRAY_REPLACE(tags, 'pooled water', 'debris / pooled water');

UPDATE label_history SET tags = ARRAY_REPLACE(tags, 'pooled water', 'debris / pooled water');

UPDATE label_validation
SET old_tags = ARRAY_REPLACE(old_tags, 'pooled water', 'debris / pooled water'),
    new_tags = ARRAY_REPLACE(new_tags, 'pooled water', 'debris / pooled water');

# --- !Downs
UPDATE label_validation
SET old_tags = ARRAY_REPLACE(old_tags, 'debris / pooled water', 'pooled water'),
    new_tags = ARRAY_REPLACE(new_tags, 'debris / pooled water', 'pooled water');

UPDATE label_history SET tags = ARRAY_REPLACE(tags, 'debris / pooled water', 'pooled water');

UPDATE label SET tags = ARRAY_REPLACE(tags, 'debris / pooled water', 'pooled water');

UPDATE tag SET tag = 'pooled water' WHERE tag = 'debris / pooled water';
