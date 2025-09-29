# --- !Ups
INSERT INTO version VALUES ('10.2.0', now(), 'Simplifies clustering in our APIs to improve performance, fixes some keyboard shortcuts');

# --- !Downs
DELETE FROM version WHERE version_id = '10.2.0';
