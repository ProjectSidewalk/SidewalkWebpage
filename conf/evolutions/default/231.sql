# --- !Ups
INSERT INTO version VALUES ('7.19.7', now(), 'Explore/Validate now refresh if they get an error from server, minimizing data loss.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.7';
