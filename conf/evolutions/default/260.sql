# --- !Ups
INSERT INTO version VALUES ('8.1.4', now(), 'Adds configs for Danville, IL deployment.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.4';
