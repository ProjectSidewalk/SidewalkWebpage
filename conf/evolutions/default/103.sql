# --- !Ups
INSERT INTO version VALUES ('6.14.2', now(), 'Fixes slow landing page load times.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.2';
