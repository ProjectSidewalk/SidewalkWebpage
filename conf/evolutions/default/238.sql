# --- !Ups
INSERT INTO version VALUES ('7.20.0', now(), 'Adds new UI to validate severity and tags.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.0';
