# --- !Ups
INSERT INTO version VALUES ('7.0.0', now(), 'Adds new Crosswalk and Pedestrian Signal label types.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.0.0';
