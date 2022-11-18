# --- !Ups
-- I've confirmed that neither timestamp is null in any database, so I'm just setting to now() to make things easy.
UPDATE label_validation SET end_timestamp = now() WHERE end_timestamp IS NULL;
ALTER TABLE label_validation ALTER COLUMN end_timestamp SET NOT NULL;
UPDATE label_validation SET start_timestamp = now() WHERE start_timestamp IS NULL;
ALTER TABLE label_validation ALTER COLUMN start_timestamp SET NOT NULL;

# --- !Downs
ALTER TABLE label_validation ALTER COLUMN start_timestamp DROP NOT NULL;
ALTER TABLE label_validation ALTER COLUMN end_timestamp DROP NOT NULL;
