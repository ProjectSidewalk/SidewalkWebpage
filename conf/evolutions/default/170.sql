# --- !Ups
INSERT INTO version VALUES ('7.9.0', now(), 'Adds a fog of war visualization to the Explore page mini map.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.9.0';
