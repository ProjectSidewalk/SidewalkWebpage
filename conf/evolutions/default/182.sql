# --- !Ups
INSERT INTO version VALUES ('7.13.1', now(), 'Fixes a bug where labels did not appear on the mini map.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.13.1';
