# --- !Ups
INSERT INTO version VALUES ('11.3.0', now(), 'Full Mapillary support, plus Portuguese translations');

# --- !Downs
DELETE FROM version WHERE version_id = '11.3.0';
