# --- !Ups
INSERT INTO version VALUES ('7.5.1', now(), 'Renames the brick tag to brick/cobblestone.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.5.1';
