-- 25.sql added gsv_data.last_viewed nullable and mainline let the running app fill it as panos were revisited;
-- 179 then makes it NOT NULL. DC went offline before any of that, so every pano is NULL (issue #4700). Backfill with
-- the last time a label was placed on the pano -- the only "viewed" evidence the legacy data has -- and now() for
-- the two panos that carry no label.
UPDATE gsv_data
SET last_viewed = last_label.t
FROM (SELECT gsv_panorama_id, MAX(time_created) AS t FROM label GROUP BY gsv_panorama_id) last_label
WHERE last_label.gsv_panorama_id = gsv_data.gsv_panorama_id AND gsv_data.last_viewed IS NULL;
UPDATE gsv_data SET last_viewed = now() WHERE last_viewed IS NULL;
