# --- !Ups
ALTER TABLE label_validation ADD source TEXT;
ALTER TABLE label_validation DROP COLUMN is_mobile;

# --- !Downs
ALTER TABLE label_validation DROP COLUMN source;
ALTER TABLE label_validation ADD is_mobile BOOLEAN;
