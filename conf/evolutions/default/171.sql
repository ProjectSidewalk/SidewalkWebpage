# --- !Ups
INSERT INTO version VALUES ('7.10.0', now(), 'Adds mission start tutorials to (desktop) Validate missions.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.10.0';
