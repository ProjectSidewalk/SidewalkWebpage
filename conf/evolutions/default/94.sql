# --- !Ups
INSERT INTO version VALUES ('6.12.1', now(), 'Adds rough lat/lng approximation to accommodate Google API removal.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.12.1';
