# --- !Ups
INSERT INTO version VALUES ('7.19.0', now(), 'Adds undo to Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.0';
