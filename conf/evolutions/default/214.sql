# --- !Ups
INSERT INTO version VALUES ('7.18.1', now(), 'Updates JDBC driver.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.18.1';
