# --- !Ups
INSERT INTO version VALUES ('7.11.1', now(), 'Fixes broken Explore page when using Firefox.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.11.1';
