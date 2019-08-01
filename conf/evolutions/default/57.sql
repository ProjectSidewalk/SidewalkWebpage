# --- !Ups
INSERT INTO version VALUES ('6.5.4', now(), 'Improves load time of audit tutorial and validation missions.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.5.4';

