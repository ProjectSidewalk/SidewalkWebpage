# --- !Ups
INSERT INTO version VALUES ('7.20.2', now(), 'Fixes a bug where Gallery would sometimes fail to load.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.2';
