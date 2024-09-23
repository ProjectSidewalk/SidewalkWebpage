# --- !Ups
INSERT INTO version VALUES ('7.19.6', now(), 'Improved performance on Explore, /timeCheck and /admin/user pages.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.6';
