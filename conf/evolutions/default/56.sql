# --- !Ups
INSERT INTO version VALUES ('6.5.3', now(), 'Tutorial now uses locally stored panoramas.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.5.3';
