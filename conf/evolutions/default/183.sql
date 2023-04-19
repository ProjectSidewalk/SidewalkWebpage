# --- !Ups
INSERT INTO version VALUES ('7.13.2', now(), 'Fixes broken tutorial.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.13.2';
