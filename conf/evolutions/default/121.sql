# --- !Ups
INSERT INTO version VALUES ('6.18.0', now(), 'Adds support for neighborhoods with holes and disconnected parts.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.18.0';
