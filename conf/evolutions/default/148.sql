# --- !Ups
INSERT INTO version VALUES ('7.5.2', now(), 'Adds La Piedad to the list of publicly deployed cities.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.5.2';
