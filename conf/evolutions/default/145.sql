# --- !Ups
INSERT INTO version VALUES ('7.5.0', now(), 'Labels added in previous sessions now show up on Explore page and are editable.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.5.0';
