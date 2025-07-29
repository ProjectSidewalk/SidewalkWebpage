# --- !Ups
INSERT INTO version VALUES ('9.0.0', now(), 'Fully rewritten backend and full API redesign.');

# --- !Downs
DELETE FROM version WHERE version_id = '9.0.0';
