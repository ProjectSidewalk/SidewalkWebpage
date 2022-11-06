# --- !Ups
INSERT INTO version VALUES ('7.8.4', now(), 'Adds accuracy and other stats to right sidebar on Explore page.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.8.4';
