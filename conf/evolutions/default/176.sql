# --- !Ups
INSERT INTO version VALUES ('7.12.1', now(), 'Adds more metadata to adminapi/panos API.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.12.1';
