# --- !Ups
INSERT INTO version VALUES ('8.1.9', now(), 'Fixes bug where RouteBuilder would show incorrect distance if zoomed in too far.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.9';
