# --- !Ups
INSERT INTO version VALUES ('11.0.0', now(), 'Major code rework to support non-Google imagery.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.0.0';
