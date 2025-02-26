# --- !Ups
INSERT INTO version VALUES ('8.1.5', now(), 'Adds neighborhoods URL param to Validate and Mobile Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.5';
