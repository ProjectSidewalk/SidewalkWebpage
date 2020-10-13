# --- !Ups
INSERT INTO version VALUES ('6.10.0', now(), 'Adds a leaderboard page.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.10.0';
