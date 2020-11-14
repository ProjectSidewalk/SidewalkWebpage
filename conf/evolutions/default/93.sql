# --- !Ups
ALTER TABLE label_point
    ADD COLUMN computation_method TEXT;

UPDATE label_point
SET computation_method = 'depth'
WHERE lat IS NOT NULL AND lng IS NOT NULL AND geom IS NOT NULL;

UPDATE label_point
SET computation_method = 'approximation1',
    lat = panorama_lat + (10 * cos(radians(heading)) / 111111),
    lng = panorama_lng + (10 * sin(radians(heading)) / (111111 * cos(radians(panorama_lat)))),
    geom = ST_SetSRID( ST_Point( panorama_lng + (10 * sin(radians(heading)) / (111111 * cos(radians(panorama_lat)))), panorama_lat + (10 * cos(radians(heading)) / 111111)), 4326)
FROM label
WHERE label_point.label_id = label.label_id
    AND computation_method IS NULL;

# --- !Downs
UPDATE label_point
SET lat = NULL,
    lng = NULL,
    geom = NULL
WHERE computation_method = 'approximation1';

ALTER TABLE label_point
    DROP COLUMN computation_method;
