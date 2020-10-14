# --- !Ups
INSERT INTO version VALUES ('6.11.0', now(), 'The set of tags on the explore page is now tailored to each city.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.11.0';
