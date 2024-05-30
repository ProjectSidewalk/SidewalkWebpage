# --- !Ups
INSERT INTO version VALUES ('7.19.5', now(), 'Adds more fine-grained control over marking data quality.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.5';
