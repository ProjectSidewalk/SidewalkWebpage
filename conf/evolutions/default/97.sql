# --- !Ups
INSERT INTO version VALUES ('6.13.0', now(), 'Replaces double click feature with a new Stuck button.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.13.0';
