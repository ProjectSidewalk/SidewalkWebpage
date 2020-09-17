# --- !Ups
INSERT INTO version VALUES ('6.3.4', now(), 'Fixes some MTurk bugs and the user dashboard in Seattle.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.3.4';
