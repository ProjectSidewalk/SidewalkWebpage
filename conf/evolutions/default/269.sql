# --- !Ups
INSERT INTO version VALUES ('8.1.12', now(), 'Adds deployments in Madison,  Niagara Falls, Chandigarh, and Tainan City');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.12';
