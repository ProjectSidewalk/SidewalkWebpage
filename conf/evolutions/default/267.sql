# --- !Ups
INSERT INTO version VALUES ('8.1.10', now(), '/admin/user page now mirrors User Dashboard with extra info.');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.10';
