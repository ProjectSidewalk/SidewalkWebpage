# --- !Ups
INSERT INTO version VALUES ('6.6.7', now(), 'Switching between auditing/validating is now optional.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.7';
