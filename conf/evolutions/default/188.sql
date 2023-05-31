# --- !Ups
INSERT INTO version VALUES ('7.14.0', now(), 'Adds educational mission start screens to Explore page.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.14.0';
