# --- !Ups
INSERT INTO version VALUES ('6.14.1', now(), 'Fixes bug where you cannot place a label.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.1';
