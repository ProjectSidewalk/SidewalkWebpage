# --- !Ups
INSERT INTO version VALUES ('7.15.0', now(), 'Adds a tool called RouteBuilder. Users can now create custom routes to follow!');

# --- !Downs
DELETE FROM version WHERE version_id = '7.15.0';
