# --- !Ups
INSERT INTO version VALUES ('6.12.0', now(), 'Adds a complete redesign of the user dashboard.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.12.0';
