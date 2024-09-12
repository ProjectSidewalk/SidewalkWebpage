# --- !Ups
ALTER TABLE tag ADD CONSTRAINT tag_label_type_id_tag_unique UNIQUE (label_type_id, tag);

# --- !Downs
ALTER TABLE tag DROP CONSTRAINT IF EXISTS tag_label_type_id_tag_unique;
