# --- !Ups
INSERT INTO version VALUES ('6.19.2', now(), 'Removes some low quality data from Gallery and Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.19.2';
