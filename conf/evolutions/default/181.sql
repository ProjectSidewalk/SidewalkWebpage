# --- !Ups
-- Fix incorrect lat/lngs since last update.
UPDATE label_point
SET geom = ST_Project(
    ST_SetSRID(ST_Point(gsv_data.lng, gsv_data.lat), 4326),
    GREATEST(0.0, 20.8794248 + 0.0184087 * (gsv_data.height / 2 - pano_y) + 0.0022135 * canvas_y),
    CASE
        WHEN heading -27.5267447 + 0.0784357 * canvas_x < -360 THEN radians(360 + heading -27.5267447 + 0.0784357 * canvas_x)
        WHEN heading -27.5267447 + 0.0784357 * canvas_x > 360 THEN radians(-360 + heading -27.5267447 + 0.0784357 * canvas_x)
        ELSE radians(heading -27.5267447 + 0.0784357 * canvas_x)
        END
)::geometry
FROM label
INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
WHERE label_point.label_id = label.label_id
    AND computation_method = 'approximation2'
    AND time_created > (SELECT version_start_time FROM version WHERE version_id = '7.13.0');

UPDATE label_point
SET lat = ST_Y(geom),
    lng = ST_X(geom)
FROM label
WHERE label_point.label_id = label.label_id
    AND computation_method = 'approximation2'
    AND time_created > (SELECT version_start_time FROM version WHERE version_id = '7.13.0');

# --- !Downs
UPDATE label_point
SET geom = ST_Project(
    ST_SetSRID(ST_Point(gsv_data.lng, gsv_data.lat), 4326),
    GREATEST(0.0, 20.8794248 + 0.0184087 * pano_y + 0.0022135 * canvas_y),
    CASE
        WHEN heading -27.5267447 + 0.0784357 * canvas_x < -360 THEN radians(360 + heading -27.5267447 + 0.0784357 * canvas_x)
        WHEN heading -27.5267447 + 0.0784357 * canvas_x > 360 THEN radians(-360 + heading -27.5267447 + 0.0784357 * canvas_x)
        ELSE radians(heading -27.5267447 + 0.0784357 * canvas_x)
        END
)::geometry
FROM label
    INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
WHERE label_point.label_id = label.label_id
    AND computation_method = 'approximation2'
    AND time_created > (SELECT version_start_time FROM version WHERE version_id = '7.13.0');

UPDATE label_point
SET lat = ST_Y(geom),
    lng = ST_X(geom)
FROM label
WHERE label_point.label_id = label.label_id
    AND computation_method = 'approximation2'
    AND time_created > (SELECT version_start_time FROM version WHERE version_id = '7.13.0');
