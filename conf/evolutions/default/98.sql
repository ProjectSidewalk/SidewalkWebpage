# --- !Ups
UPDATE label_point
SET computation_method = 'approximation2',
    geom = ST_Project(
        ST_SetSRID(ST_Point(panorama_lng, panorama_lat), 4326),
        20.8794248 + 0.0184087 * sv_image_y + 0.0022135 * canvas_y,
        radians(heading -27.5267447 + 0.0784357 * canvas_x)
        )::geometry
FROM label
WHERE label_point.label_id = label.label_id
  AND computation_method <> 'depth';

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
