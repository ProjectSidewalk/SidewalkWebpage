# --- !Ups
INSERT INTO version VALUES ('10.2.1', now(), 'minor dependency updates, reducing number of requests for AI validations');

# --- !Downs
DELETE FROM version WHERE version_id = '10.2.1';
