# --- !Ups
INSERT INTO version VALUES ('6.14.7', now(), 'Adds Spanish translations for Sidewalk Gallery.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.7';
