# --- !Ups
INSERT INTO version VALUES ('7.13.4', now(), 'Adds validation counts to Gallery');

# --- !Downs
DELETE FROM version WHERE version_id = '7.13.4';
