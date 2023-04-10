# --- !Ups
-- Making a table to hold old sv_image_x/y and pano-specific data so that we can roll back if we find an issue.
CREATE TABLE old_label_metadata (
    label_id INTEGER NOT NULL,
    old_pano_x INT NOT NULL,
    old_pano_y INT NOT NULL,
    old_camera_heading DOUBLE PRECISION NOT NULL,
    old_camera_pitch DOUBLE PRECISION NOT NULL,
    old_pano_lat DOUBLE PRECISION,
    old_pano_lng DOUBLE PRECISION,
    FOREIGN KEY (label_id) REFERENCES label(label_id)
);

-- Store the old data.
INSERT INTO old_label_metadata (label_id, old_pano_x, old_pano_y, old_camera_heading, old_camera_pitch, old_pano_lat, old_pano_lng)
SELECT label.label_id, label_point.sv_image_x, label_point.sv_image_y, label.photographer_heading, label.photographer_pitch, label.panorama_lat, label.panorama_lng
FROM label
INNER JOIN label_point ON label.label_id = label_point.label_id
WHERE label.time_created < (SELECT version_start_time FROM version WHERE version_id = '7.12.2');

-- Add the pano-specific data to the gsv_data table. Use the most recent values from the label table for each.
ALTER TABLE gsv_data RENAME COLUMN image_width TO width;
ALTER TABLE gsv_data RENAME COLUMN image_height TO height;
ALTER TABLE gsv_data RENAME COLUMN image_date TO capture_date;
ALTER TABLE gsv_data
    ADD COLUMN camera_heading DOUBLE PRECISION,
    ADD COLUMN camera_pitch DOUBLE PRECISION,
    ADD COLUMN lat DOUBLE PRECISION,
    ADD COLUMN lng DOUBLE PRECISION;

UPDATE gsv_data
SET camera_heading = recent.photographer_heading,
    camera_pitch = recent.photographer_pitch,
    lat = panorama_lat,
    lng = panorama_lng
FROM (
         SELECT gsv_panorama_id,
                photographer_heading,
                photographer_pitch,
                panorama_lat,
                panorama_lng,
                row_number() OVER (PARTITION BY gsv_panorama_id ORDER BY time_created DESC)
         FROM label
         WHERE photographer_heading <> 'NaN' AND photographer_pitch <> 'NaN'
     ) recent
WHERE gsv_data.gsv_panorama_id = recent.gsv_panorama_id
  AND row_number = 1;

-- Now that they've been moved to gsv_data, remove the columns from the label table.
ALTER TABLE label
    DROP COLUMN photographer_heading,
    DROP COLUMN photographer_pitch,
    DROP COLUMN panorama_lat,
    DROP COLUMN panorama_lng;

-- Update the sv_image_x/y values in the database. The math is essentially calling this in UtilitiesPanomarker.js:
-- calculatePanoXYFromPov(calculatePovIfCentered({heading: heading, pitch: pitch, zoom: zoom}, canvas_x, canvas_y, 720, 480), camera_heading, width, height).
UPDATE label_point
SET sv_image_x = (width + ROUND(width * (((atan2((360 / tan(0.5 * (CASE WHEN zoom = 1 THEN 89.75 WHEN zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END) * PI() / 180))*cos((pitch * PI() / 180.0)) * sin((heading * PI() / 180.0)) + (canvas_x - 360) * SIGN(cos((pitch * PI() / 180.0))) * cos((heading * PI() / 180.0)) + (240 - canvas_y) * -sin((pitch * PI() / 180.0)) * sin((heading * PI() / 180.0)), (360 / tan(0.5 * (CASE WHEN zoom = 1 THEN 89.75 WHEN zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END) * PI() / 180)) * cos((pitch * PI() / 180.0)) * cos((heading * PI() / 180.0)) + (canvas_x - 360) * -SIGN(cos((pitch * PI() / 180.0))) * sin((heading * PI() / 180.0)) + (240 - canvas_y) * -sin((pitch * PI() / 180.0)) * cos((heading * PI() / 180.0))) * 180.0 / PI())::DECIMAL % 360 + 360)::DECIMAL % 360 - (camera_heading + 180)::DECIMAL % 360) / 360)) % width,
    sv_image_y = (height / 2) - ROUND((height / 2) * ((asin(((0.5 * 720 / tan(0.5 * (CASE WHEN zoom = 1 THEN 89.75 WHEN zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * sin((pitch * PI() / 180.0)) + (480 / 2 - canvas_y) * cos((pitch * PI() / 180.0))) / sqrt(((0.5 * 720 / tan(0.5 * (CASE WHEN zoom = 1 THEN 89.75 WHEN zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * cos((pitch * PI() / 180.0)) * sin((heading * PI() / 180.0)) + (canvas_x - 720 / 2) * SIGN(cos((pitch * PI() / 180.0))) * cos((heading * PI() / 180.0)) + (480 / 2 - canvas_y) * -sin((pitch * PI() / 180.0)) * sin((heading * PI() / 180.0)))^2 + ((0.5 * 720 / tan(0.5 * (CASE WHEN zoom = 1 THEN 89.75 WHEN zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * cos((pitch * PI() / 180.0)) * cos((heading * PI() / 180.0)) + (canvas_x - 720 / 2) * -SIGN(cos((pitch * PI() / 180.0))) * sin((heading * PI() / 180.0)) + (480 / 2 - canvas_y) * -sin((pitch * PI() / 180.0)) * cos((heading * PI() / 180.0)))^2 + ((0.5 * 720 / tan(0.5 * (CASE WHEN zoom = 1 THEN 89.75 WHEN zoom = 2 THEN 53 ELSE 195.93 / 1.92^3 END)*PI()/180)) * sin((pitch * PI() / 180.0)) + (480 / 2 - canvas_y) * cos((pitch * PI() / 180.0)))^ 2)) * 180.0 / PI()) / 90))
FROM label
INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
WHERE label_point.label_id = label.label_id
    AND gsv_data.width IS NOT NULL
    AND gsv_data.height IS NOT NULL
    AND gsv_data.camera_heading <> 'NaN'
    AND gsv_data.camera_pitch <> 'NaN';

-- Some small updates to column names, etc.
ALTER TABLE gsv_data
    ALTER COLUMN last_viewed SET DEFAULT now(),
    ALTER COLUMN last_viewed SET NOT NULL;
ALTER TABLE label_point RENAME COLUMN sv_image_x to pano_x;
ALTER TABLE label_point RENAME COLUMN sv_image_y to pano_y;


# --- !Downs
-- Undoing those small updates.
ALTER TABLE label_point RENAME COLUMN pano_y to sv_image_y;
ALTER TABLE label_point RENAME COLUMN pano_x to sv_image_x;
ALTER TABLE gsv_data
    ALTER COLUMN last_viewed DROP NOT NULL,
    ALTER COLUMN last_viewed SET DEFAULT NULL;

-- Put the old data back in the label_point table.
UPDATE label_point
SET sv_image_x = old_pano_x,
    sv_image_y = old_pano_y
FROM old_label_metadata
WHERE label_point.label_id = old_label_metadata.label_id;

-- Put the old data back in the label table.
ALTER TABLE label
    ADD COLUMN photographer_heading DOUBLE PRECISION NOT NULL DEFAULT 'NaN',
    ADD COLUMN photographer_pitch DOUBLE PRECISION NOT NULL DEFAULT 'NaN',
    ADD COLUMN panorama_lat DOUBLE PRECISION,
    ADD COLUMN panorama_lng DOUBLE PRECISION;

UPDATE label
SET photographer_heading = old_label_metadata.old_camera_heading,
    photographer_pitch = old_label_metadata.old_camera_pitch,
    panorama_lat = old_label_metadata.old_pano_lat,
    panorama_lng = old_label_metadata.old_pano_lng
FROM old_label_metadata
WHERE label.label_id = old_label_metadata.label_id;

-- Remove the columns from gsv_data and the entire old_label_metadata table.
ALTER TABLE gsv_data
    DROP COLUMN camera_heading,
    DROP COLUMN camera_pitch,
    DROP COLUMN lat,
    DROP COLUMN lng;
ALTER TABLE gsv_data RENAME COLUMN width TO image_width;
ALTER TABLE gsv_data RENAME COLUMN height TO image_height;
ALTER TABLE gsv_data RENAME COLUMN capture_date TO image_date;

DROP TABLE old_label_metadata;
