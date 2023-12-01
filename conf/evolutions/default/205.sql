# --- !Ups
INSERT INTO version VALUES ('7.16.1', now(), 'Fixes Validate page bugs and updates our API page.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.16.1';
