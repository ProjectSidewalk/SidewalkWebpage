# --- !Ups
INSERT INTO version VALUES ('7.17.0', now(), 'RouteBuilder has been completely redesigned.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.17.0';
