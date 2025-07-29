# --- !Ups
INSERT INTO version VALUES ('9.0.5', now(), 'Fixes a few bugs and improves Chandigarh AI pilot.');

# --- !Downs
DELETE FROM version WHERE version_id = '9.0.5';
