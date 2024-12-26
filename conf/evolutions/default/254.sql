# --- !Ups
INSERT INTO version VALUES ('8.0.1', now(), 'Authentication is now shared between all servers, no need to login multiple times!');

# --- !Downs
DELETE FROM version WHERE version_id = '8.0.1';
