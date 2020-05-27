# --- !Ups
INSERT INTO version VALUES ('6.8.1', now(), 'Adds ability to reset your password.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.8.1';
