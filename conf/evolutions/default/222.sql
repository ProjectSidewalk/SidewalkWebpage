# --- !Ups
INSERT INTO version VALUES ('7.19.2', now(), 'Fixes admin page not loading.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.2';
