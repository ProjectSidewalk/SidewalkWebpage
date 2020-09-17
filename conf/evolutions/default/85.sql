# --- !Ups
INSERT INTO version VALUES ('6.9.0', now(), 'Cleans up the navbar, labeling guide, skylines, and map tooltips.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.9.0';
