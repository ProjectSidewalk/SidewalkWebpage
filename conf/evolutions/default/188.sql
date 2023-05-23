# --- !Ups
# --- do we need more lat/lng cords?
CREATE TABLE config (
    open_status TEXT NOT NULL,
    mapathon_event_link TEXT NOT NULL,
    city_center_lat DOUBLE PRECISION NOT NULL,
    city_center_lng DOUBLE PRECISION NOT NULL,
    southwest_boundary_lat DOUBLE PRECISION NOT NULL,
    southwest_boundary_lng DOUBLE PRECISION NOT NULL,
    northeast_boundary_lat DOUBLE PRECISION NOT NULL,
    northeast_boundary_lng DOUBLE PRECISION NOT NULL,
    attribute_center_lat DOUBLE PRECISION NOT NULL,
    attribute-center-lng DOUBLE PRECISION NOT NULL,
    attribute-zoom DOUBLE PRECISION NOT NULL,
    attribute-lat1 DOUBLE PRECISION NOT NULL,
    attribute-lng1 DOUBLE PRECISION NOT NULL,
    attribute-lat2 DOUBLE PRECISION NOT NULL,
    attribute-lng2 DOUBLE PRECISION NOT NULL,
    street-center-lat DOUBLE PRECISION NOT NULL,
    street-center-lng DOUBLE PRECISION NOT NULL,
    street_zoom DOUBLE PRECISION NOT NULL,
    street_lat1 DOUBLE PRECISION NOT NULL,
    street_lng1 DOUBLE PRECISION NOT NULL,
    street_lat2 DOUBLE PRECISION NOT NULL,
    street_lng2 DOUBLE PRECISION NOT NULL,
    region_center_lat DOUBLE PRECISION NOT NULL,
    region_center_lng DOUBLE PRECISION NOT NULL,
    region_zoom DOUBLE PRECISION NOT NULL,
    region_lat1 DOUBLE PRECISION NOT NULL,
    region_lng1 DOUBLE PRECISION NOT NULL,
    region_lat2 DOUBLE PRECISION NOT NULL,
    region_lng2 DOUBLE PRECISION NOT NULL,
    default_map_zoom DOUBLE PRECISION NOT NULL,
    tutorial_street_edge_id INT NOT NULL,
    update_offset_hours INT NOT NULL,
    excluded_tags TEXT NOT NULL

);

# Insert one row into the database, choosing the correct city based on the db name.
INSERT INTO config VALUES ('partially', 'NOTE: There is nothing here', 47.615, -122.332, 47.400, -122.664, 47.850, -122.000,
-122.300, 15.5, 47.615, -122.307, 47.623, -122.293, 47.618, -122.299, 16.0, 47.611,
-122.309, 47.625, -122.289, 47.616, -122.296, 13.0, 47.600, -122.320, 47.636, -122.275,
11.75, 27645, 3, '[
      "tactile warning"
      "garage entrance"
      "street vendor"
      "no pedestrian priority"
      "uncovered manhole"
      "level with sidewalk"
      "APS"
      "missing crosswalk"
      "painted sidewalk"
      "pedestrian arcade"
      "too close to traffic"]'
) WHERE current_database() = 'sidewalk-seattle';

# ---!Downs
DROP TABLE config;