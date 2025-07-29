# --- !Ups
INSERT INTO version VALUES ('9.0.3', now(), 'Hotfix for Explore and Validate repeatedly refreshing.');

# --- !Downs
DELETE FROM version WHERE version_id = '9.0.3';
