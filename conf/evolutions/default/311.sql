# --- !Ups
INSERT INTO version VALUES ('11.4.0', now(), 'Complete LabelMap redesign, and a new mobile landing page.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.4.0';
