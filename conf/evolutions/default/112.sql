# --- !Ups
INSERT INTO version VALUES ('6.15.1', now(), 'Upgrades npm and dev dependencies.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.15.1';
