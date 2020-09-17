# --- !Ups
INSERT INTO version VALUES ('6.6.4', now(), 'Adds a new map visualization at /labelmap.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.4';
