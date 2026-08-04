# --- !Ups
INSERT INTO version VALUES ('11.6.1', now(), 'Fixes a bug where the leaderboard failed to load.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.6.1';
