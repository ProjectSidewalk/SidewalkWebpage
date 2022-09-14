# --- !Ups
INSERT INTO version VALUES ('7.7.0', now(), 'Adds label tags to the /attributesWithLabels API.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.7.0';
