# --- !Ups
INSERT INTO version VALUES ('7.19.1', now(), 'Adds a Raw Labels public API.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.1';
