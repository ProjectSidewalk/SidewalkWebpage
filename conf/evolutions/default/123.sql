# --- !Ups
INSERT INTO version VALUES ('6.19.1', now(), 'Fixes a bug where StreetView went dark after changing browser zoom.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.19.1';
