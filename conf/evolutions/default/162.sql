# --- !Ups
INSERT INTO version VALUES ('7.8.2', now(), 'Various improvements to data quality and the API.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.8.2';
