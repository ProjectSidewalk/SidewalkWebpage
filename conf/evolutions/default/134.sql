# --- !Ups
INSERT INTO version VALUES ('7.2.0', now(), 'Adds new surface tags to Curb Ramp and Crosswalk labels.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.2.0';
