# --- !Ups
INSERT INTO version VALUES ('9.0.4', now(), 'Fixes issues with authentication and repeated neighborhood complete messages.');

# --- !Downs
DELETE FROM version WHERE version_id = '9.0.4';
