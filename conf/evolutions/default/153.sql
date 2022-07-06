# --- !Ups
INSERT INTO version VALUES ('7.6.2', now(), 'Adds a Crosswalk tag in Amsterdam called level with sidewalk.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.6.2';
