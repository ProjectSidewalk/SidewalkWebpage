# --- !Ups
INSERT INTO version VALUES ('6.3.0', now(), 'Adds a computer vision ground truth tool for admins.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.3.0';
