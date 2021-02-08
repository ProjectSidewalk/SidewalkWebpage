# --- !Ups
INSERT INTO version VALUES ('6.14.0', now(), 'Introducing: Sidewalk Gallery!');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.0';
