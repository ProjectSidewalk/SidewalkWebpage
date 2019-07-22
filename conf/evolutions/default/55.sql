# --- !Ups
INSERT INTO version VALUES ('6.5.2', now(), 'Fixes bug where users were not getting obstacle validation missions.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.5.2';
