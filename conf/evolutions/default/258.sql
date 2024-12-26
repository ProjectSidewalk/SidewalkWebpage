# --- !Ups
INSERT INTO version VALUES ('8.1.2', now(), 'Adds admin URL param filters to New Validate Beta.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.2';
