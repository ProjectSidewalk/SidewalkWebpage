-- 3,773 DC label_point rows (1.4 %, all computation_method 'depth', 2015-2020) hold lat/lng around 9e13: garbage
-- from the legacy client's depth-data position code. 338's label_point_lat_lng_check rejects them. Null the
-- position out (lat, lng, geom) and mark the row 'approximation2' so it reads as "needs the modern estimator";
-- the post-migration metadata refetch + position recompute that every DC label needs anyway (179 never applied on
-- DC, and its pano widths are all NULL, so 352/366 can't reach them here) restores a real position. The originals
-- are kept in dc_migration_nulled_label_point for the report (issue #4700).
CREATE TABLE dc_migration_nulled_label_point AS
SELECT label_point_id, label_id, lat, lng, computation_method
FROM label_point WHERE lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180;
UPDATE label_point SET lat = NULL, lng = NULL, geom = NULL, computation_method = 'approximation2'
WHERE label_point_id IN (SELECT label_point_id FROM dc_migration_nulled_label_point);
