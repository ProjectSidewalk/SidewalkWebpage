# --- !Ups
INSERT INTO version VALUES ('7.20.6', now(), 'Fixes conflicting tags but in new Validate, adds LA & Mendota configs.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.6';
