# --- !Ups
INSERT INTO version VALUES ('6.3.3', now(), 'Fixes bug where you could not pan away from label before validating');

# --- !Downs
DELETE FROM version WHERE version_id = '6.3.3';
