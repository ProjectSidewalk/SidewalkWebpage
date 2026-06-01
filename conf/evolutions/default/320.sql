# --- !Ups
INSERT INTO version VALUES ('11.4.3', now(), 'Now showing backups for old, expired imagery.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.4.3';
