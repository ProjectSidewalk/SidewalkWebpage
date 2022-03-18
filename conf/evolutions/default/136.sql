# --- !Ups
INSERT INTO version VALUES ('7.2.1', now(), 'Clicking on navigation messages can now be used to move.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.2.1';
