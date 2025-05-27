# --- !Ups
INSERT INTO version VALUES ('8.1.12', now(), 'Adds deployments in Madison, WI; Niagara Falls, NY; Chandigarh, India; and Tainan City, Taiwan');

# --- !Downs
DELETE FROM version WHERE version_id = '8.1.12';
