# --- !Ups
INSERT INTO version VALUES ('6.8.2', now(), 'Fixes a few Spanish translations.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.8.2';
