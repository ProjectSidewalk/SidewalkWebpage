# --- !Ups
INSERT INTO version VALUES ('6.15.2', now(), 'Redesigns the Sidewalk Gallery interface.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.15.2';
