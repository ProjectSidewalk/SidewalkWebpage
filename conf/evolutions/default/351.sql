# --- !Ups
INSERT INTO version VALUES ('11.8.0', now(), 'Redesigns RouteBuilder, the Explore minimap, and the label card; adds a native About page, Free Exploration, a map filter sidebar, and an across-city leaderboard.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.8.0';
