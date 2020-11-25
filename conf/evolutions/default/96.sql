# --- !Ups
INSERT INTO version VALUES ('6.12.3', now(), 'Fixes bug where second label of validation missions set incorrectly.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.12.3';
