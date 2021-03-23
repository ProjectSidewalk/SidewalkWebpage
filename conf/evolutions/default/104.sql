# --- !Ups
INSERT INTO version VALUES ('6.14.3', now(), 'It is now clear which images have expired imagery in LabelMap.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.3';
