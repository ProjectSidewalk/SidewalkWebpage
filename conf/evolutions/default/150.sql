# --- !Ups
INSERT INTO version VALUES ('7.6.0', now(), 'Adds Crosswalk and Pedestrian Signal to Validate and fixes a bug preventing tutorial completion.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.6.0';
