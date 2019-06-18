# --- !Ups
INSERT INTO version VALUES ('6.4.0', now(), 'Validation page now loads faster and you can resume missions in the middle of a street.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.4.0';
