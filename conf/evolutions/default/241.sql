# --- !Ups
INSERT INTO version VALUES ('7.20.4', now(), 'HOTFIX: Removes automated zoom for Explore/Validate on Chrome (hopefully temporarily).');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.4';
