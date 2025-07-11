# --- !Ups
ALTER TABLE label_point
    ADD COLUMN gsv_lat double precision,
    ADD COLUMN gsv_lng double precision;

# --- !Downs
ALTER TABLE label_point
    DROP COLUMN gsv_lat,
    DROP COLUMN gsv_lng;
