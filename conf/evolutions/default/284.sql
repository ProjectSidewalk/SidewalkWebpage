# --- !Ups
INSERT INTO version VALUES ('10.0.0', now(), 'Changes severity ratings from a 5-point scale to 3-point scale.');

# --- !Downs
DELETE FROM version WHERE version_id = '10.0.0';
