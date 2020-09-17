# --- !Ups
INSERT INTO version VALUES ('6.7.0', now(), 'Adds partial internationalization and Spanish translations.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.7.0';
