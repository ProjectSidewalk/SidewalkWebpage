# --- !Ups
INSERT INTO version VALUES ('6.19.4', now(), 'Adds validation info to the public APIs.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.19.4';
