# --- !Ups
INSERT INTO version VALUES ('11.1.1', now(), 'Adds infra3D support in LabelMap, User Dashboard, and Admin pages.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.1.1';
