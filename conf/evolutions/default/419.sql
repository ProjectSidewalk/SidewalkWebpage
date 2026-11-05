# --- !Ups
INSERT INTO version VALUES ('11.18.0', now(), 'Explore''s minimap no longer uses Google Maps, and the leaderboard has a new "Your team" table.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.18.0';
