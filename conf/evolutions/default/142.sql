# --- !Ups
INSERT INTO version VALUES ('7.4.1', now(), 'Fixes bug where using an arrow key breaks the tutorial.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.4.1';
