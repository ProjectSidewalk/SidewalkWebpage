# --- !Ups
INSERT INTO version VALUES ('7.12.2', now(), 'Fixes a bug preventing users from finishing the tutorial when instructions covered the UI.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.12.2';
