# --- !Ups
INSERT INTO version VALUES ('7.3.0', now(), 'Removes severity for the Pedestrian Signal label type.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.3.0';
