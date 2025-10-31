# --- !Ups
INSERT INTO version VALUES ('10.3.0', now(), 'Removes severity for No Sidewalk label type');

# --- !Downs
DELETE FROM version WHERE version_id = '10.3.0';
