# --- !Ups
INSERT INTO version VALUES ('6.15.0', now(), 'Introducing: Gallery 1.1, with an expanded modal with GSV interaction!');

# --- !Downs
DELETE FROM version WHERE version_id = '6.15.0';
