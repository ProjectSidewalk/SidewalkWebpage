# --- !Ups
ALTER TABLE pano_data ADD COLUMN camera_roll DOUBLE PRECISION;

ALTER TABLE region_completion
    ALTER COLUMN total_distance TYPE DOUBLE PRECISION,
    ALTER COLUMN audited_distance TYPE DOUBLE PRECISION;

# --- !Downs
ALTER TABLE region_completion
    ALTER COLUMN total_distance TYPE REAL,
    ALTER COLUMN audited_distance TYPE REAL;

ALTER TABLE pano_data DROP COLUMN camera_roll;
