# --- !Ups
INSERT INTO version VALUES ('7.19.10', now(), 'Reorders data in GSV info popup.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.10';
