# --- !Ups
-- Keep this description free of semicolons. Play's evolutions parser splits statements on every one it finds, even
-- inside a string literal, and the resulting fragment fails to apply with "unterminated string literal".
INSERT INTO version VALUES ('11.8.0', now(), 'Redesigns RouteBuilder, the Explore minimap, and the label card. Adds a native About page, Free Exploration, a map filter sidebar, and an across-city leaderboard.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.8.0';
