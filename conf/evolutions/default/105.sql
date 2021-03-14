# --- !Ups
INSERT INTO version VALUES ('6.14.4', now(), 'Adds ability to set site language in the navbar.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.4';
