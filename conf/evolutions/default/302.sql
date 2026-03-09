# --- !Ups
INSERT INTO version VALUES ('11.2.0', now(), 'Improved Mapillary support across the entire site.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.2.0';
