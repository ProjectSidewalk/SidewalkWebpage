# --- !Ups
INSERT INTO version VALUES ('6.6.0', now(), 'Adds a mobile validation interface!');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.0';
