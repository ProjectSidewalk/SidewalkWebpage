# --- !Ups
INSERT INTO version VALUES ('6.3.2', now(), 'Fixes some workarounds turkers were using to get confirmation code.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.3.2';
