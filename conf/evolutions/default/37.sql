# --- !Ups
INSERT INTO version VALUES ('6.2.0', now(), 'Mission complete modal now shows progress across all users.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.2.0';
