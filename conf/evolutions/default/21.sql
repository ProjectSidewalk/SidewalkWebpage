# --- !Ups
INSERT INTO version VALUES ('5.0.0', now(), 'Overhaul mission infrastructure and anonymous user ids.');

# --- !Downs
DELETE FROM version WHERE version_id = '5.0.0';
