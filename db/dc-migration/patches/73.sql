-- Patched mainline 73.sql (issue #4700). The original is a positional INSERT assuming the
-- pre-135 gsv_data column order; DC's fork already reshaped gsv_data (its evo 15 ~ mainline 135),
-- so name the columns. Dimensions stay NULL to match the post-135 state (135 nulls them on
-- mainline and DC's fork did the same) — this also keeps 179's coordinate recompute a guaranteed
-- no-op for the tutorial pano.
INSERT INTO gsv_data (gsv_panorama_id, image_width, image_height, tile_width, tile_height,
                      image_date, copyright, expired, last_viewed)
VALUES ('tutorial', NULL, NULL, NULL, NULL, '2014-05', '', FALSE, now());
