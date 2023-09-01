# --- !Ups
INSERT INTO version VALUES ('7.15.6', now(), 'Explore mini map now shows streets you haven''t audited in gray.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.15.6';
