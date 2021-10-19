# --- !Ups
INSERT INTO version VALUES ('6.19.0', now(), 'Adds an inter-team leaderboard.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.19.0';
