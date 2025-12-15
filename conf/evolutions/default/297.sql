# --- !Ups
INSERT INTO version VALUES ('10.5.0', now(), 'Drastically improves load times on Validate pages.');

# --- !Downs
DELETE FROM version WHERE version_id = '10.5.0';
