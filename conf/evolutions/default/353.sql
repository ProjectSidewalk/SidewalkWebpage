# --- !Ups
INSERT INTO version VALUES ('11.8.1', now(), 'Improves lat/lng estimation for all labels, speeds up landing page & mapillary pano loads plus some bug fixes.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.8.1';
