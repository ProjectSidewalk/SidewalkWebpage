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
    attribute-center-lng,
    attribute-zoom,
    attribute-lat1,
    attribute-lng1,
    attribute-lat2,
    attribute-lng2,
    street-center-lat,
    street-center-lng,
    street_zoom,
    street_lat1,
    street_lng1,
    street_lat2,
    street_lng2,
    region_center_lat,
    region_center_lng,
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
INSERT INTO config VALUES ('partially', 'NOTE: There is nothing here', 47.615, -122.332, 47.400) WHERE current_database() = 'sidewalk-seattle';

# ---!Downs
DROP TABLE config;