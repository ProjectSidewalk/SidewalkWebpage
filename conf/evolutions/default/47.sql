# --- !Ups
INSERT INTO version VALUES ('6.3.5', now(), 'Fixes UI bug when starting new validation missions.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.3.5';
