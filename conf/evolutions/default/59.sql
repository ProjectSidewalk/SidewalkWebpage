# --- !Ups
INSERT INTO version VALUES ('6.5.5', now(), 'Fixes bug where blank screens would show up on /validate.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.5.5';
