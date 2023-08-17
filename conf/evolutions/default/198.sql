# --- !Ups
ALTER TABLE label_validation ADD source text;

# --- !Downs
ALTER TABLE label_validation DROP COLUMN source;