# --- !Ups
INSERT INTO version VALUES ('7.8.1', now(), 'Fixes location of GSV links on Explore and Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.8.1';
