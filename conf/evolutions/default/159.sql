# --- !Ups
INSERT INTO version VALUES ('7.8.0', now(), 'Adds a section to the User Dashboard showing recent labeling mistakes.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.8.0';
