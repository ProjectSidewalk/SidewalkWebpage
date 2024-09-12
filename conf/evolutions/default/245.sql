# --- !Ups
ALTER TABLE tag
    ADD CONSTRAINT tag_label_type_id_tag_unique UNIQUE (label_type_id, tag),
    ADD COLUMN mutually_exclusive_with TEXT,
    ADD CONSTRAINT tag_mutually_exclusive_with_self_reference_check CHECK (mutually_exclusive_with IS DISTINCT FROM tag);

# --- !Downs
ALTER TABLE tag
    DROP CONSTRAINT IF EXISTS tag_mutually_exclusive_with_self_reference_check,
    DROP COLUMN mutually_exclusive_with,
    DROP CONSTRAINT IF EXISTS tag_label_type_id_tag_unique;
