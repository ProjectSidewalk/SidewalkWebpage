# --- !Ups
INSERT INTO version VALUES ('11.14.0', now(), 'Adds important places and neighborhood highlights to AccessScore, admin pages for teams, and the ability to change a label type.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.14.0';
