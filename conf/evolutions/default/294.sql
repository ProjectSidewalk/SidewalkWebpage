# --- !Ups
INSERT INTO version VALUES ('10.4.0', now(), 'AI now explicitly adds Unsure validations in the system');

# --- !Downs
DELETE FROM version WHERE version_id = '10.4.0';
