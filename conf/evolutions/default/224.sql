# --- !Ups
INSERT INTO version VALUES ('7.19.3', now(), 'Fixes validating through Gallery and LabelMap.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.3';
