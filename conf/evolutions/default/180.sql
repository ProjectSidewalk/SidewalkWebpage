# --- !Ups
INSERT INTO version VALUES ('7.13.0', now(), 'Labels no longer move after placing them, and data in APIs used for CV have been fixed.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.13.0';
