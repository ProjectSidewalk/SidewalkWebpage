# --- !Ups
INSERT INTO version VALUES ('6.6.6', now(), 'Adds validation support to /labelmap.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.6';
