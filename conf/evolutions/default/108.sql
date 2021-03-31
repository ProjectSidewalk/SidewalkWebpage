# --- !Ups
INSERT INTO version VALUES ('6.14.6', now(), 'Adds tag examples in tooltips.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.14.6';
