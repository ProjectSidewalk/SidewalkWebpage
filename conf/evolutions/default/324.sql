# --- !Ups
INSERT INTO version VALUES ('11.5.0', now(), 'Refreshes the Explore page UI and brings AccessScore plus several new endpoints to the v3 API.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.5.0';
