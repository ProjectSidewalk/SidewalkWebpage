# --- !Ups
INSERT INTO version VALUES ('11.20.0', now(), 'Explore now plans each mission''s walk up front, and new Neighborhood Reports.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.20.0';
