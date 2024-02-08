# --- !Ups
INSERT INTO version VALUES ('7.15.4', now(), 'Fixes bug where pano date was incorrect in Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.15.4';
