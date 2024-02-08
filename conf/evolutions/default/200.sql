# --- !Ups
INSERT INTO version VALUES ('7.15.5', now(), 'Improves database performance, adds new tags in Burnaby and Zurich.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.15.5';
