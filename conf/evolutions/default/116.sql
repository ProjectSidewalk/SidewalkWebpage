# --- !Ups
INSERT INTO version VALUES ('6.16.0', now(), 'Adds more validation functionality in Gallery.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.16.0';
