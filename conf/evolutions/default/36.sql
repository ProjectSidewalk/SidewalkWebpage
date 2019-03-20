# --- !Ups
INSERT INTO version VALUES ('6.1.1', now(), 'Adds parked car tag for obstacle labels, fixes timer for turkers.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.1.1';

