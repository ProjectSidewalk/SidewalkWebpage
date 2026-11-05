# --- !Ups
INSERT INTO version VALUES ('11.15.0', now(), 'Adds street steepness to AccessScore, and label deletion for admins.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.15.0';
