# --- !Ups
INSERT INTO version VALUES ('11.6.0', now(), 'Redesigns the user dashboard, leaderboard, admin tools, and sign-up flow, and adds shareable label links.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.6.0';
