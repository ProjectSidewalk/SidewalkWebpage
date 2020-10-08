# --- !Ups
INSERT INTO version VALUES ('6.9.1', now(), 'Cleans up the landing page.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.9.1';
