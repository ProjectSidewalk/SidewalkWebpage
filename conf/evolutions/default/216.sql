# --- !Ups
INSERT INTO version VALUES ('7.18.3', now(), 'Follow-up fix for API data not updating.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.18.3';
