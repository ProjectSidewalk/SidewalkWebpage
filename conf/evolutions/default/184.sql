# --- !Ups
INSERT INTO version VALUES ('7.13.3', now(), 'Adds a Not Sure validation filter to Gallery and LabelMap.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.13.3';
