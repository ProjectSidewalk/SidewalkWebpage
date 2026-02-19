# --- !Ups
INSERT INTO version VALUES ('11.1.0', now(), 'Validate redesigned with default disagree options.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.1.0';
