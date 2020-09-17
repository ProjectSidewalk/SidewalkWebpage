# --- !Ups
INSERT INTO version VALUES ('6.3.1', now(), 'We now lose data less often when closing the site in Chrome.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.3.1';
