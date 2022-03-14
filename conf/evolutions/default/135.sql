# --- !Ups
ALTER TABLE gsv_data
    ADD COLUMN center_heading FLOAT,
    ADD COLUMN origin_heading FLOAT,
    ADD COLUMN origin_pitch FLOAT;

# --- !Downs
ALTER TABLE gsv_data
    DROP COLUMN center_heading,
    DROP COLUMN origin_heading,
    DROP COLUMN origin_pitch;
