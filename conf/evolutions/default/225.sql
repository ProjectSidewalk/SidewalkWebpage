# --- !Ups
INSERT INTO version VALUES ('7.19.4', now(), 'Fixes broken /userStats API.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.4';
