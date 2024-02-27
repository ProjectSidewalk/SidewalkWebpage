# --- !Ups
INSERT INTO version VALUES ('7.18.0', now(), 'Adds automatic zoom to Explore/Validate on Chrome/Safari.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.18.0';
