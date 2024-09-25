# --- !Ups
INSERT INTO version VALUES ('7.20.7', now(), 'Adds new tags and speed limit indicator to Explore/Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.7';
