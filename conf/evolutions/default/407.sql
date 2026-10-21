# --- !Ups
INSERT INTO version VALUES ('11.16.0', now(), 'Adds a full-screen mode and image brightness controls to Explore.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.16.0';
