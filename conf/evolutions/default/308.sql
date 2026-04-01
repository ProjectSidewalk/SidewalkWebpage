# --- !Ups
INSERT INTO version VALUES ('11.3.1', now(), 'Some older images can now be viewed in Gallery and LabelMap.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.3.1';
