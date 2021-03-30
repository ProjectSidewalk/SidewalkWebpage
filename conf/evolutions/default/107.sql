# --- !Ups
INSERT INTO version VALUES ('6.14.5', now(), 'Speeds up nightly label clustering.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.5';
