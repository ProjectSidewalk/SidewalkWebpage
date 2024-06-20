# --- !Ups
INSERT INTO version VALUES ('7.19.9', now(), 'We now check for expired images nightly, keeping LabelMap up-to-date.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.19.9';
