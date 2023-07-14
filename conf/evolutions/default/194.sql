# --- !Ups
INSERT INTO version VALUES ('7.15.2', now(), 'Prevents crashes for large API requests, cleans up Explore page UI.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.15.2';
