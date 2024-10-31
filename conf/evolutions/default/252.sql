# --- !Ups
INSERT INTO version VALUES ('8.0.0', now(), 'Adds unified login: One account now works across all cities!');

# --- !Downs
DELETE FROM version WHERE version_id = '8.0.0';
