# --- !Ups
INSERT INTO version VALUES ('6.5.6', now(), 'Improves functionality of the "hide label" feature on validation.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.5.6';
