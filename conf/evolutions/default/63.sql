# --- !Ups
INSERT INTO version VALUES ('6.6.1', now(), 'Fixes numerous bugs when completing a mission or neighborhood.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.1';
