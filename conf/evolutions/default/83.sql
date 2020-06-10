# --- !Ups
INSERT INTO version VALUES ('6.8.4', now(), 'Adds a comment text field to the validation page.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.8.4';
