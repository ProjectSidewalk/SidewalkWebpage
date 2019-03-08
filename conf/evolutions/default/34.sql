# --- !Ups
INSERT INTO version VALUES ('6.1.0', now(), 'Adds insufficient landing space tag for curb ramp labels.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.1.0';

