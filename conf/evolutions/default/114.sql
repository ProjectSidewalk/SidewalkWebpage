# --- !Ups
INSERT INTO version VALUES ('6.15.3', now(), 'Replaces shadows with gray outlines in Gallery.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.15.3';
