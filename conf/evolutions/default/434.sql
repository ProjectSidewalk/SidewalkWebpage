# --- !Ups
INSERT INTO version VALUES ('11.21.1', now(), 'Fixes the server health check and adds a pilot in Goiânia, Brazil.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.21.1';
