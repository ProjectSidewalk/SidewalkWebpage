# --- !Ups
INSERT INTO version VALUES ('7.13.5', now(), 'Adds a Surface Problem tag for utility panels');

# --- !Downs
DELETE FROM version WHERE version_id = '7.13.5';
