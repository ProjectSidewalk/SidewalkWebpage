-- #5920 undo: restore every label 5920-dc-linear-projection.sql touched from the backup table it keeps. ONE schema
-- (sidewalk_dc), a write role. Not restored: the human votes it voided, which stay in voided_label_validation
-- (bringing them back is a job of its own if it is ever wanted); the AI votes and assessments it deleted, which the
-- nightly job makes again at the restored pixels; and the centerline offsets of the rows #5667 had moved, which are
-- the correct values for those positions. A reapply after this undo voids only votes cast since; a person who
-- re-voted on one of these labels in between would collide with their archived vote and abort it.
--
--   psql "dbname=sidewalk options=--search_path=sidewalk_dc,public" -U sidewalk_dc -v ON_ERROR_STOP=1 \
--     -f tools/one-off/5920-undo-dc-linear-projection.sql
BEGIN;
-- label.street_edge_id is insert-only in the app, so restoring the backed-up value cannot overwrite anything that
-- happened in between. The inequality only skips no-op rows.
UPDATE label
SET street_edge_id = old_label_point_linear.street_edge_id
FROM old_label_point_linear
WHERE label.label_id = old_label_point_linear.label_id
  AND label.street_edge_id <> old_label_point_linear.street_edge_id;

UPDATE label_point
SET heading = old_label_point_linear.heading,
    pitch = old_label_point_linear.pitch,
    pano_x = old_label_point_linear.pano_x,
    pano_y = old_label_point_linear.pano_y,
    lat = old_label_point_linear.lat,
    lng = old_label_point_linear.lng,
    geom = old_label_point_linear.geom,
    computation_method = old_label_point_linear.computation_method::computation_method
FROM old_label_point_linear
WHERE label_point.label_point_id = old_label_point_linear.label_point_id;

-- Recomputed rather than restored: the backup holds the offset as it stood before the run, which for a row #5667
-- had moved was stale (377, docs/evolutions.md).
UPDATE label_point
SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
FROM old_label_point_linear, label, street_edge
WHERE label_point.label_point_id = old_label_point_linear.label_point_id
  AND label.label_id = label_point.label_id
  AND street_edge.street_edge_id = label.street_edge_id
  AND label_point.geom IS NOT NULL
  AND label_point.centerline_offset_m IS DISTINCT FROM label_centerline_offset_m(label_point.geom, street_edge.geom);

DROP TABLE old_label_point_linear;
COMMIT;
