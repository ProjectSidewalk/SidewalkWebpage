# --- !Ups
ALTER TABLE mission
  ADD COLUMN label_type_id INT,
  ADD CONSTRAINT label_type_id FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id);

# --- !Downs
ALTER TABLE mission
  DROP COLUMN label_type_id;
