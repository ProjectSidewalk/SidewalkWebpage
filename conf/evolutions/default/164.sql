# --- !Ups
INSERT INTO version VALUES ('7.8.3', now(), 'Fixes various street and neighborhood API bugs.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.8.3';
