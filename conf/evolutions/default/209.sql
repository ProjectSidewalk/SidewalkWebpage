# --- !Ups
INSERT INTO version VALUES ('7.17.1', now(), 'Adds recent labeling timestamps to overallStats API.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.17.1';
