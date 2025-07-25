# --- !Ups
INSERT INTO version VALUES ('9.1.0', now(), 'Adds a deployment cities map and renames Crosswalk to Marked Crosswalk.');

# --- !Downs
DELETE FROM version WHERE version_id = '9.1.0';
