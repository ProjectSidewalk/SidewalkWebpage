# --- !Ups
INSERT INTO version VALUES ('8.1.1', now(), 'Reverts automatic zoom for Explore and Validate due to image qualiity issues.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.1';
