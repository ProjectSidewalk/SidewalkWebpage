# --- !Ups
INSERT INTO version VALUES ('7.20.8', now(), 'Fixes bug where labels were being saved with incorrect zoom level.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.8';
