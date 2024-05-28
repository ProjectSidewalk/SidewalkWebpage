# --- !Ups
INSERT INTO version VALUES ('7.19.8', now(), 'St. Louis server is now public, attempting to fix crashing servers.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.8';
