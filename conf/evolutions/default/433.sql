# --- !Ups
INSERT INTO version VALUES ('11.21.0', now(), 'Validators are shown training examples of common mistakes.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.21.0';
