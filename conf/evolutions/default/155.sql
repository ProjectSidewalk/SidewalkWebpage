# --- !Ups
INSERT INTO version VALUES ('7.6.3', now(), 'Fixes neighborhood completion percentage on maps.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.6.3';
