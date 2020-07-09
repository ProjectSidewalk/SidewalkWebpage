# --- !Ups
INSERT INTO version VALUES ('6.8.5', now(), 'Internationalizes dates and distance units.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.8.5';
