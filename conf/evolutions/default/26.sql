# --- !Ups
ALTER TABLE mission
  ADD COLUMN label_type_id INT;

# --- !Downs
ALTER TABLE mission
  DROP COLUMN label_type_id;