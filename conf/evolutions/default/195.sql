# --- !Ups
CREATE TABLE config (
                        open_status              TEXT             NOT NULL,
                        mapathon_event_link      TEXT,
                        city_center_lat          DOUBLE PRECISION NOT NULL,
                        city_center_lng          DOUBLE PRECISION NOT NULL,
                        southwest_boundary_lat   DOUBLE PRECISION NOT NULL,
                        southwest_boundary_lng   DOUBLE PRECISION NOT NULL,
                        northeast_boundary_lat   DOUBLE PRECISION NOT NULL,
                        northeast_boundary_lng   DOUBLE PRECISION NOT NULL,
                        default_map_zoom         DOUBLE PRECISION NOT NULL,
                        tutorial_street_edge_id  INT              NOT NULL,
                        update_offset_hours      INT              NOT NULL,
                        excluded_tags            TEXT             NOT NULL,
                        api_attribute_center_lat DOUBLE PRECISION NOT NULL,
                        api_attribute_center_lng DOUBLE PRECISION NOT NULL,
                        api_attribute_zoom       DOUBLE PRECISION NOT NULL,
                        api_attribute_lat1       DOUBLE PRECISION NOT NULL,
                        api_attribute_lng1       DOUBLE PRECISION NOT NULL,
                        api_attribute_lat2       DOUBLE PRECISION NOT NULL,
                        api_attribute_lng2       DOUBLE PRECISION NOT NULL,
                        api_street_center_lat    DOUBLE PRECISION NOT NULL,
                        api_street_center_lng    DOUBLE PRECISION NOT NULL,
                        api_street_zoom          DOUBLE PRECISION NOT NULL,
                        api_street_lat1          DOUBLE PRECISION NOT NULL,
                        api_street_lng1          DOUBLE PRECISION NOT NULL,
                        api_street_lat2          DOUBLE PRECISION NOT NULL,
                        api_street_lng2          DOUBLE PRECISION NOT NULL,
                        api_region_center_lat    DOUBLE PRECISION NOT NULL,
                        api_region_center_lng    DOUBLE PRECISION NOT NULL,
                        api_region_zoom          DOUBLE PRECISION NOT NULL,
                        api_region_lat1          DOUBLE PRECISION NOT NULL,
                        api_region_lng1          DOUBLE PRECISION NOT NULL,
                        api_region_lat2          DOUBLE PRECISION NOT NULL,
                        api_region_lng2          DOUBLE PRECISION NOT NULL,
                        database_name            TEXT             NOT NULL
);

-- seattle
INSERT INTO config VALUES ('partially', NULL , 47.615, -122.332, 47.400, -122.664, 47.850, -122.000, 11.75, 27645, 3, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 47.619, -122.300, 15.5, 47.615, -122.307, 47.623, -122.293, 47.618, -122.299, 16.0, 47.611, -122.309, 47.625, -122.289, 47.616, -122.296, 13.0, 47.600, -122.320, 47.636, -122.275, 'sidewalk-seattle');

-- columbus
INSERT INTO config VALUES('partially', NULL, 40.000, -83.002, 39.925, -83.102, 40.105, -82.902, 13.0, 37090, -2, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 39.965, -83.000, 16.0, 39.962, -82.995, 39.968, -83.004, 39.960, -82.992, 15.0, 39.950, -82.982, 39.970, -83.002, 39.965, -83.002, 13.0, 39.950, -82.980, 40.000, -83.050, 'sidewalk-columbus');

-- cdmx
INSERT INTO config VALUES('partially', NULL, 19.410, -99.182, 19.040, -99.600, 19.600, -98.700, 12.25, 286005, 2, '["tactile warning" "fire hydrant" "parked bike" "construction" "no pedestrian priority" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 19.410, -99.182, 16.25, 19.487, -99.190, 19.495, -99.180, 19.410, -99.182, 16.25, 19.487, -99.190, 19.495, -99.180, 19.470, -99.177, 14.0, 19.455, -99.190, 19.495, -99.160, 'sidewalk-cdmx');

-- spgg
INSERT INTO config VALUES('fully', NULL, 25.648, -100.385, 25.498, -100.670, 25.948, -100.070, 13.0, 7192, 0, '["tactile warning" "fire hydrant" "parked bike" "construction" "no pedestrian priority" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]',  25.660, -100.409, 17.0, 25.656, -100.413, 25.664, -100.405, 25.660, -100.409, 16.0, 25.650, -100.419, 25.670, -100.399, 25.659, -100.400, 14.0, 25.610, -101.000, 25.673, -100.375, 'sidewalk-spgg');

-- pittsburgh
INSERT INTO config VALUES('partially', NULL, 40.424, -79.960, 40.000, -81.000, 41.000, -79.000, 13.0, 26293, -1, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 40.446, -79.959, 15.25, 40.443, -79.963, 40.449, -79.995, 40.446, -79.959, 15.25, 40.443, -79.963, 40.449, -79.995, 40.442, -79.959, 13.0, 40.425, -79.979, 40.465, -79.939, 'sidewalk-pittsburgh');

-- sidewalk / dc
INSERT INTO config VALUES('fully', NULL, 38.892, -76.830, 38.761, -77.262, 39.060, -76.830, 12.0, 15250, -9, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 38.910, -76.984, 15.0, 38.909, -76.989, 38.912, -76.982, 38.920, -77.019, 14.0, 38.910, -77.028, 38.929, -77.009, 38.920, -77.019, 14.0, 38.910, -77.028, 38.929, -77.009, 'sidewalk');

-- chicago
INSERT INTO config VALUES('partially', NULL, 41.820, -87.769, 40.750, -89.750, 43.000, -86.500, 10.25, 331320, 1, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 41.823, -87.622, 15.0, 41.816, -87.615, 41.83, -87.629, 42.085, -87.985, 15.25, 42.076, -87.993, 42.094, -87.963, 41.793, -88.146, 13.0, 41.700, -88.200, 42.000, -88.000, 'sidewalk-chicago');

-- amsterdam
INSERT INTO config VALUES('partially', NULL, 52.345, 4.925, 52.055, 4.425, 52.655, 5.425, 12.25, 34098, -6, '["garage entrance" "street vendor" "points into traffic" "missing tactile warning" "brick/cobblestone" "uncovered manhole" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 52.372, 4.886, 15.25, 52.295, 4.780, 52.450, 4.990, 52.355, 4.795, 15.25, 52.300, 4.600, 52.400, 4.850, 52.357, 4.918, 14.0, 52.200, 4.805, 52.450, 5.005, 'sidewalk-amsterdam');

-- la-piedad
INSERT INTO config VALUES('partially', NULL, 20.345, -102.036, 20.240, -102.335, 20.440, -101.735, 12.25, 5370, -3, '["tactile warning" "fire hydrant" "parked bike" "construction" "no pedestrian priority" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 20.345, -102.036, 16.0, 20.343, -102.034, 20.347, -102.038, 20.345, -102.036, 16.0, 20.343, -102.034, 20.347, -102.038, 20.345, -102.036, 14.0, 20.330, -120.020, 20.360, -102.050, 'sidewalk-la-piedad');

-- oradell
INSERT INTO config VALUES('fully', NULL, 40.995, -74.030, 40.155, -74.240, 41.755, -73.830, 14.5, 499, -5, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 40.947, -74.041, 16.0, 40.946, -74.044, 40.948, -74.038, 40.947, -74.041, 16.0, 40.946, -74.044, 40.948, -74.038, 40.955, -74.030, 13.0, 40.155, -73.830, 41.755, -74.230, 'sidewalk-oradell');

-- validation
INSERT INTO config VALUES('partially', NULL, 47.615, -122.332, 40.750, -122.664, 47.850, -86.500, 12.0, 854, -7, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 41.575, -87.865, 13.0, 41.560, -87.885, 41.590, -87.847, 41.575, -87.865, 13.0, 41.560, -87.885, 41.590, -87.847, 41.643, -87.707, 13.0, 41.622, -87.738, 41.659, -87.683, 'sidewalk_validation');

-- zurich
INSERT INTO config VALUES('partially', NULL, 47.373, 8.542, 47.297, 8.427, 47.457, 8.639, 15.0, 11242, -8, '["tactile warning" "street vendor" "uncovered manhole" "APS" "level with sidewalk" "missing crosswalk" painted sidewalk" "pedestrian arcade" "too close to traffic"]', 47.736, 8.544, 16.5, 47.375, 8.543, 47.377, 8.545, 47.736, 8.544, 16.5, 47.375, 8.543, 47.377, 8.545, 47.3755, 8.543, 14.5, 47.370, 8.540, 47.380, 8.548, 'sidewalk-zurich');

-- taipei
INSERT INTO config VALUES('partially', NULL, 25.036, 121.536, 21.684, 119.947, 25.306, 122.282, 14.25, 26434, 10, '["tactile warning" "uncovered manhole" "APS" "level with sidewalk" "missing crosswalk" "rail/tram track" "brick/cobblestone"]', 25.023, 121.534, 16.0, 25.020, 121.531, 25.026, 121.537, 25.023, 121.534, 16.0, 25.020, 121.531, 25.026, 121.537, 25.021, 121.532, 14.5, 25.016, 119.947, 25.027, 122.282, 'sidewalk-taipei');

-- auckland
INSERT INTO config VALUES('partially', NULL, -36.598, 174.765458, -37.870572, 173.765458, -35.870572, 175.765458, 12.0, 76949, 6, '["tactile warning" "fire hydrant" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', -36.908, 174.671, 15.5, -36.910, 174.668, -36.908, 174.674, -36.908, 174.671, 15.5, -36.910, 174.668, -36.908, 174.674, -36.909, 174.666, 13.0, -36.921, 174.655, -36.896, 174.679, 'sidewalk-auckland');

-- cuenca
INSERT INTO config VALUES('partially', NULL, -2.898, -79.005, -3.892, -80.008, -1.892, -78.008, 15.75, 15431, -4, '["tactile warning" "fire hydrant" "parked bike" "construction" "no pedestrian priority" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', -2.900, -79.005, 16.0, -2.902, -79.008, -2.898, -79.002, -2.900, -79.005, 16.0, -2.902, -79.008, -2.898, -79.002, -2.898, -79.005, 14.0, -2.906, -79.012, -2.891, -78.998, 'sidewalk-cuenca');

-- newberg
INSERT INTO config VALUES('fully', NULL, 45.306, -122.958, 45.265, -123.010, 45.345, -122.900, 13.75, 1692, 4, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 45.319, -122.975, 16.0, 45.305, -123.000, 45.327, -122.960, 45.319, -122.975, 14.0, 45.310, -123.000, 45.327, -122.960, 45.319, -122.975, 13.0, 45.305, -123.010, 45.345, -122.950, 'sidewalk-newberg');

-- crowdstudy
INSERT INTO config VALUES ('partially', NULL , 47.615, -122.332, 47.400, -122.664, 47.850, -122.000, 11.75, 27645, 7, '["tactile warning" "garage entrance" "street vendor" "no pedestrian priority" "uncovered manhole" "level with sidewalk" "APS" "missing crosswalk" "painted sidewalk" "pedestrian arcade" "too close to traffic"]', 47.619, -122.300, 15.5, 47.615, -122.307, 47.623, -122.293, 47.618, -122.299, 16.0, 47.611, -122.309, 47.625, -122.289, 47.616, -122.296, 13.0, 47.600, -122.320, 47.636, -122.275, 'sidewalk-crowdstudy');

-- new taipei
INSERT INTO config VALUES('partially', NULL, 25.036, 121.536, 21.684, 119.947, 25.306, 122.282, 14.25, 492898, 12, '["tactile warning" "uncovered manhole" "APS" "level with sidewalk" "missing crosswalk" "rail/tram track" "brick/cobblestone"]', 25.023, 121.534, 16.0, 25.020, 121.531, 25.026, 121.537, 25.023, 121.534, 16.0, 25.020, 121.531, 25.026, 121.537, 25.021, 121.532, 14.5, 25.016, 119.947, 25.027, 122.282, 'sidwalk-new-taipei');

-- keelung
INSERT INTO config VALUES('partially', NULL, 25.036, 121.536, 21.684, 119.947, 25.306, 122.282, 14.25, 492898, 9, '["tactile warning" "uncovered manhole" "APS" "level with sidewalk" "missing crosswalk" "rail/tram track" "brick/cobblestone"]', 25.023, 121.534, 16.0, 25.020, 121.531, 25.026, 121.537, 25.023, 121.534, 16.0, 25.020, 121.531, 25.026, 121.537, 25.021, 121.532, 14.5, 25.016, 119.947, 25.027, 122.282, 'sidewalk-keelung');

-- insert all then conditonal delete all but the current_database
DELETE FROM config WHERE current_database() != database_name;

ALTER TABLE config DROP COLUMN database_name;

# --- !Downs
DROP TABLE config;