# --- !Ups
ALTER TABLE gsv_data
    ADD COLUMN center_heading FLOAT,
    ADD COLUMN origin_heading FLOAT,
    ADD COLUMN origin_pitch FLOAT,
    ALTER COLUMN image_width DROP NOT NULL,
    ALTER COLUMN image_height DROP NOT NULL,
    ALTER COLUMN tile_width DROP NOT NULL,
    ALTER COLUMN tile_height DROP NOT NULL;

UPDATE gsv_data SET image_width = NULL, image_height = NULL, tile_width = NULL, tile_height = NULL;

# --- !Downs
UPDATE gsv_data
SET image_width = 13312, image_height = 6656, tile_width = 512, tile_height = 512
WHERE image_width IS NULL OR image_height IS NULL OR tile_width IS NULL OR tile_height IS NULL;

ALTER TABLE gsv_data
    DROP COLUMN center_heading,
    DROP COLUMN origin_heading,
    DROP COLUMN origin_pitch;
