# --- !Ups
INSERT INTO version VALUES ('11.21.2', now(), 'Major improvements to database performance.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.21.2';
