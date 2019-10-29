# --- !Ups
INSERT INTO version VALUES ('6.6.5', now(), 'Fixes /labelmap bug erroneously saying there was no imagery.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.5';
