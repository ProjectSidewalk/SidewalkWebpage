# --- !Ups
INSERT INTO version VALUES ('6.0.0', now(), 'Adds validation interface, clusters to the API, and code parameterized by city.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.0.0';

