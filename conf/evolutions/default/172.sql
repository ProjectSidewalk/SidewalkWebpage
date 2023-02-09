# --- !Ups
INSERT INTO version VALUES ('7.11.0', now(), 'Adds validation filters to Gallery.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.11.0';
