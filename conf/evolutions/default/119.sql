# --- !Ups
INSERT INTO version VALUES ('6.17.0', now(), 'Adds support for organizations to leaderboard and user dashboard.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.17.0';
