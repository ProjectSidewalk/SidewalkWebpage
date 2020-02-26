# --- !Ups
INSERT INTO version VALUES ('6.7.1', now(), 'Adds more neighborhoods for Columbus, OH.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.7.1';
