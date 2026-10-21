# --- !Ups
INSERT INTO version VALUES ('11.14.1', now(), 'Fixes Infra3d panoramas going black and Explore reloading into an old route.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.14.1';
