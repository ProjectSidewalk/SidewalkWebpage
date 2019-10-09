# --- !Ups
INSERT INTO version VALUES ('6.6.2', now(), 'Fixes bug where users never validated obstacle labels.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.2';
