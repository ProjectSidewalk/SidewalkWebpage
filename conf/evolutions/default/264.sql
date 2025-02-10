# --- !Ups
INSERT INTO version VALUES ('8.1.7', now(), 'Improves voice control support on the Validate page.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.7';
