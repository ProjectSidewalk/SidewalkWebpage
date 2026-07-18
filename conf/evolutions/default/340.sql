# --- !Ups
INSERT INTO version VALUES ('11.7.0', now(), 'Adds Lived Experience Stories, redesigns the navbar, label detail card, and Explore tutorial intro/outro screens, and improves database integrity.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.7.0';
