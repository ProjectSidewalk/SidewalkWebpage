# --- !Ups
ALTER TABLE label_point
    ADD COLUMN geom_using_gsv geometry(Point, 4326);

# --- !Downs
ALTER TABLE label_point
    DROP COLUMN geom_using_gsv;
