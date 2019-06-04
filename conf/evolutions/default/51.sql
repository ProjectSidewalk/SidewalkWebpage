# --- !Ups

ALTER TABLE label_validation
  ADD is_mobile INT;

# --- !Downs

ALTER TABLE label_validation
  DROP COLUMN is_mobile;