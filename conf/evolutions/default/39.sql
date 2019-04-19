# --- !Ups
INSERT INTO version VALUES ('6.2.2', now(), 'Adds a Resume Mission modal to the validation page.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.2.2';
