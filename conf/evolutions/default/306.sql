# --- !Ups
ALTER TABLE pano_data ADD COLUMN camera_roll DOUBLE PRECISION;

# --- !Downs
ALTER TABLE pano_data DROP COLUMN camera_roll;
