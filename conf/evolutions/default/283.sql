# --- !Ups
ALTER TABLE label DROP COLUMN temporary;

# --- !Downs
ALTER TABLE label ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE
