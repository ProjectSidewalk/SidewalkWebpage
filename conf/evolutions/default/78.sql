# --- !Ups
INSERT INTO version VALUES ('6.8.0', now(), 'Adds Spanish translations.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.8.0';
