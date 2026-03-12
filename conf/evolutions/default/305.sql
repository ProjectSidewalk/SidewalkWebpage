# --- !Ups
INSERT INTO version VALUES ('11.2.1', now(), 'Improved Mapillary support and web accessibility');

# --- !Downs
DELETE FROM version WHERE version_id = '11.2.1';
