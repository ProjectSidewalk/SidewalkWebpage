# --- !Ups
INSERT INTO version VALUES ('6.19.3', now(), 'Validation accuracy is now used for determining street audit priority.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.19.3';
