# --- !Ups
INSERT INTO version VALUES ('6.5.1', now(), 'Validations of labels from users with few validations now prioritized.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.5.1';
