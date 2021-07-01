# --- !Ups
INSERT INTO version VALUES ('6.15.4', now(), 'Fixes Gallery bug where multiple labels were on one image.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.15.4';
