# --- !Ups
INSERT INTO version VALUES ('7.18.2', now(), 'Fixes password reset emails not sending and API data not updating.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.18.2';
