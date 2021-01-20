# --- !Ups
<<<<<<< HEAD
UPDATE tag SET tag = 'height difference' WHERE tag_id = 34;
INSERT INTO tag VALUES ( 38, 3, 'narrow' );
INSERT INTO tag VALUES ( 39, 4, 'height difference' );

# --- !Downs
UPDATE tag SET tag = 'large step' WHERE tag_id = 34;
DELETE FROM label_tag WHERE tag_id IN (38, 39);
DELETE FROM tag WHERE tag_id IN (38, 39);
=======
UPDATE label_point
SET computation_method = 'approximation2',
    geom = ST_Project(
        ST_SetSRID(ST_Point(panorama_lng, panorama_lat), 4326),
        GREATEST(0.0, 20.8794248 + 0.0184087 * sv_image_y + 0.0022135 * canvas_y),
        CASE
            WHEN heading -27.5267447 + 0.0784357 * canvas_x < -360 THEN radians(360 + heading -27.5267447 + 0.0784357 * canvas_x)
            WHEN heading -27.5267447 + 0.0784357 * canvas_x > 360 THEN radians(-360 + heading -27.5267447 + 0.0784357 * canvas_x)
            ELSE radians(heading -27.5267447 + 0.0784357 * canvas_x)
            END
        )::geometry
FROM label
WHERE label_point.label_id = label.label_id
  AND (computation_method <> 'depth' OR computation_method IS NULL);

UPDATE label_point
SET lat = ST_Y(geom),
    lng = ST_X(geom)
FROM label
WHERE label_point.label_id = label.label_id
  AND computation_method = 'approximation2';

# --- !Downs
UPDATE label_point
SET computation_method = 'approximation1',
    lat = panorama_lat + (10 * cos(radians(heading)) / 111111),
    lng = panorama_lng + (10 * sin(radians(heading)) / (111111 * cos(radians(panorama_lat)))),
    geom = ST_SetSRID( ST_Point(
                                   panorama_lng + (10 * sin(radians(heading)) / (111111 * cos(radians(panorama_lat)))),
                                   panorama_lat + (10 * cos(radians(heading)) / 111111)
                           ), 4326)
FROM label
WHERE label_point.label_id = label.label_id
  AND computation_method = 'approximation2';
>>>>>>> 2763e877da99f3bc7a7cea04a69fbceb3ff89b1e
