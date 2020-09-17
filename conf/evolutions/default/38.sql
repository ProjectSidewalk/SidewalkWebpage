# --- !Ups
INSERT INTO version VALUES ('6.2.1', now(), 'Fixes some bugs when completing a mission and starting another one right after.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.2.1';
