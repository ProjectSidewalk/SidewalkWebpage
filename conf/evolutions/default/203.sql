# --- !Ups
INSERT INTO version VALUES ('7.16.0', now(), 'Adds Crosswalk and Pedestrian Signal labels to the Explore tutorial.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.16.0';
