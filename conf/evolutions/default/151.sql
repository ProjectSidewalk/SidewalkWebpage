# --- !Ups
INSERT INTO version VALUES ('7.6.1', now(), 'Fixes a bug that broke Validate, Gallery, and LabelMap.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.6.1';
