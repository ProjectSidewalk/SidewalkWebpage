# --- !Ups
INSERT INTO version VALUES ('9.0.1', now(), 'Hotfix for a bug that prevented Gallery from loading.');

# --- !Downs
DELETE FROM version WHERE version_id = '9.0.1';
