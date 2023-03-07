# --- !Ups
INSERT INTO version VALUES ('7.12.0', now(), 'Adds Mandarin translations and new RouteBuilder tool.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.12.0';
