# --- !Ups
INSERT INTO version VALUES ('7.15.1', now(), 'Fixes a bug that prevented users from doing a second Validate mission.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.15.1';
