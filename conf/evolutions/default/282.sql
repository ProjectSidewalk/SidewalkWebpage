# --- !Ups
INSERT INTO version VALUES ('9.2.0', now(), 'Adds AI validation and suggested tags.');

# --- !Downs
DELETE FROM version WHERE version_id = '9.2.0';
