# --- !Ups
INSERT INTO version VALUES ('7.20.3', now(), 'Fixes broken keyboard shortcuts in Validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.3';
