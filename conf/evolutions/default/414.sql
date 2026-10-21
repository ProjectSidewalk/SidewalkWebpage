# --- !Ups
INSERT INTO version VALUES ('11.17.1', now(), 'Fixed the site slowing down during mapathons.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.17.1';
