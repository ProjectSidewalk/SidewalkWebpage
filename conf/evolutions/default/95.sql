# --- !Ups
INSERT INTO version VALUES ('6.12.2', now(), 'Fixes bug where first label of validation missions set incorrectly.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.12.2';
