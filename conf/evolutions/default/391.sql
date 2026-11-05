# --- !Ups
-- No semicolons in the description: Play's parser splits statements on them even inside a string literal.
INSERT INTO version VALUES ('11.13.0', now(), 'Adds the AccessScore tool, a smarter Validate queue, and minimap crumbs showing where you can go next.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.13.0';
