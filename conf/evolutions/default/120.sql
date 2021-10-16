# --- !Ups
ALTER TABLE region
    ALTER COLUMN geom TYPE public.geometry(MultiPolygon, 4326)
        USING ST_Multi(geom);

# --- !Downs
-- NOTE This really only works on single polygons. If a row is truly a multipolygon, you'll need to figure out how to
--      manually separate them into multiple regions, assign the correct streets to them, etc.
ALTER TABLE region
    ALTER COLUMN geom TYPE public.geometry(Polygon, 4326)
        USING ST_GeometryN(geom, 1);
