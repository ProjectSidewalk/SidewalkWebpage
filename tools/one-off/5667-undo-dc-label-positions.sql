-- #5667 undo: put every label 5667-dc-label-positions.sql moved back where it was, from the backup table that
-- script keeps. ONE schema (sidewalk_dc), a write role. The pano_data metadata part 1 wrote stays (accurate
-- metadata for real panos; 366's Down made the same call).
--
--   psql "dbname=sidewalk options=--search_path=sidewalk_dc,public" -U sidewalk_dc -v ON_ERROR_STOP=1 \
--     -f tools/one-off/5667-undo-dc-label-positions.sql
BEGIN;
-- Restore every modified row from the backup. Labels created after the Up are absent from it and correctly keep
-- their live-computed values. label.street_edge_id is insert-only in the app, so restoring the backed-up value
-- cannot overwrite anything that happened in between. The inequality only skips no-op rows.
UPDATE label
SET street_edge_id = old_label_point_coords_2.street_edge_id
FROM old_label_point_coords_2
WHERE label.label_id = old_label_point_coords_2.label_id
  AND label.street_edge_id <> old_label_point_coords_2.street_edge_id;

UPDATE label_point
SET pano_x = old_label_point_coords_2.pano_x,
    pano_y = old_label_point_coords_2.pano_y,
    lat = old_label_point_coords_2.lat,
    lng = old_label_point_coords_2.lng,
    geom = old_label_point_coords_2.geom,
    computation_method = old_label_point_coords_2.computation_method::computation_method
FROM old_label_point_coords_2
WHERE label_point.label_point_id = old_label_point_coords_2.label_point_id;

DROP TABLE old_label_point_coords_2;
COMMIT;
