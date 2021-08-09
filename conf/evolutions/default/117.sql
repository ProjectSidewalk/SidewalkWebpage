# --- !Ups
INSERT INTO version VALUES ('6.16.1', now(), 'Adds border to interactive GSV in Gallery when a label is validated.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.16.1';
