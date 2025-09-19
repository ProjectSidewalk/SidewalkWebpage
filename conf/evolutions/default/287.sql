# --- !Ups
INSERT INTO version VALUES ('10.1.0', now(), 'Now validating past labels with AI and adds AI-generated labels endpoint');

# --- !Downs
DELETE FROM version WHERE version_id = '10.1.0';
