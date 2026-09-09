-- Patched mainline 28.sql (issue #4700): same nearest-street backfill, but as an index-assisted
-- KNN (ORDER BY geom <-> point) instead of ORDER BY ST_Distance(...), which cannot use the gist
-- index and scans every street per label (~4B distance calls on DC's 271k labels x 15k streets).
-- On PostGIS >= 2.2 the <-> operator is exact geometry distance, so the chosen street is
-- identical to the original's ST_Distance ASC LIMIT 1. Fallback + NOT NULL are verbatim.
ALTER TABLE label
  ADD COLUMN street_edge_id INTEGER;

UPDATE label
SET street_edge_id = nearest.street_edge_id
FROM label_point,
LATERAL (
  SELECT street_edge.street_edge_id
  FROM street_edge
  ORDER BY street_edge.geom <-> ST_SetSRID(ST_MakePoint(label_point.lng, label_point.lat),
                                           Find_SRID('sidewalk', 'street_edge', 'geom'))
  LIMIT 1
) nearest
WHERE label_point.label_id = label.label_id
  AND label_point.lat IS NOT NULL
  AND label_point.lng IS NOT NULL;

UPDATE label
  SET street_edge_id = (
    SELECT a.street_edge_id
    FROM audit_task as a
    WHERE a.audit_task_id = label.audit_task_id
    LIMIT 1
  )
  WHERE street_edge_id IS NULL;

ALTER TABLE label
  ALTER COLUMN street_edge_id SET NOT NULL;
