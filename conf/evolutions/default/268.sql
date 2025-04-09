# --- !Ups
INSERT INTO version VALUES ('8.1.11', now(), 'Fixes /admin/user map not showing labels for users with a space in their username');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.11';
