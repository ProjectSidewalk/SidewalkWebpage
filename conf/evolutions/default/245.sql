# --- !Ups
-- No mutually exclusive tags exist together in a prod database, so we don't need to clean existing data.
ALTER TABLE tag
    ADD CONSTRAINT tag_label_type_id_tag_unique UNIQUE (label_type_id, tag),
    ADD COLUMN mutually_exclusive_with TEXT,
    ADD CONSTRAINT tag_mutually_exclusive_with_self_reference_check CHECK (mutually_exclusive_with IS DISTINCT FROM tag);

UPDATE tag SET mutually_exclusive_with = 'tactile warning' WHERE tag = 'missing tactile warning';
UPDATE tag SET mutually_exclusive_with = 'missing tactile warning' WHERE tag = 'tactile warning';
UPDATE tag SET mutually_exclusive_with = 'no alternate route' WHERE tag = 'alternate route present';
UPDATE tag SET mutually_exclusive_with = 'alternate route present' WHERE tag = 'no alternate route';
UPDATE tag SET mutually_exclusive_with = 'street has no sidewalks' WHERE tag = 'street has a sidewalk';
UPDATE tag SET mutually_exclusive_with = 'street has a sidewalk' WHERE tag = 'street has no sidewalks';
UPDATE tag SET mutually_exclusive_with = 'two buttons' WHERE tag = 'one button';
UPDATE tag SET mutually_exclusive_with = 'one button' WHERE tag = 'two buttons';

# --- !Downs
ALTER TABLE tag
    DROP CONSTRAINT IF EXISTS tag_mutually_exclusive_with_self_reference_check,
    DROP COLUMN mutually_exclusive_with,
    DROP CONSTRAINT IF EXISTS tag_label_type_id_tag_unique;
