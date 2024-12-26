# --- !Ups
INSERT INTO version VALUES ('8.1.0', now(), 'Adds automatic zoom for Explore and Validate (again)!');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.0';
