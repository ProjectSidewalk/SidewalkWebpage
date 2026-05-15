# --- !Ups
INSERT INTO version VALUES ('11.4.2', now(), 'Fixes a bug where team assignments were being overwritten.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.4.2';
