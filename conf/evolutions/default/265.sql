# --- !Ups
INSERT INTO version VALUES ('8.1.8', now(), 'Improves Admin page performance, fixes Validate loading bugs, and adds new keyboard shortcuts to Gallery/Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.8';
