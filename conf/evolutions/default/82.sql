# --- !Ups
INSERT INTO version VALUES ('6.8.3', now(), 'Fixes a user sign up bug.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.8.3';
