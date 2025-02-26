# --- !Ups
INSERT INTO version VALUES ('8.1.3', now(), 'Improves load time for speed limit on Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.3';
