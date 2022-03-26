# --- !Ups
INSERT INTO version VALUES ('7.1.0', now(), 'Updates label tags for Amsterdam and new Crosswalk / Pedestrian Signal label types.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.1.0';
