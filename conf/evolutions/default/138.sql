# --- !Ups
INSERT INTO version VALUES ('7.3.1', now(), 'Fixes a bug in smooth panning on the Explore page.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.3.1';
