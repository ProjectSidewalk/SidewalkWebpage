# --- !Ups
INSERT INTO version VALUES ('7.18.4', now(), 'Updates set of Pedestrian Signal tags.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.18.4';
