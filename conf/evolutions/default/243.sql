# --- !Ups
INSERT INTO version VALUES ('7.20.5', now(), 'Cleans up Gallery UI & adds tooltips to new Validate UI.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.5';
