# --- !Ups
ALTER TABLE label
  ADD COLUMN street_edge_id INTEGER;

UPDATE label
  SET street_edge_id = (
      SELECT street_edge_id FROM street_edge AS s
      ORDER BY ST_Distance(
          s.geom,
          ST_SetSRID(
              ST_MakePoint(
                  (
                      SELECT lp.lng
                      FROM label_point AS lp
                      WHERE lp.label_id = label.label_id
                      LIMIT 1
                  ), (
                      SELECT lp.lat
                      FROM label_point AS lp
                      WHERE lp.label_id = label.label_id
                      LIMIT 1
                  )),
              Find_SRID('sidewalk', 'street_edge', 'geom')
          )
      ) ASC
      LIMIT 1
  )
  WHERE (SELECT lp.lat FROM label_point AS lp WHERE lp.label_id = label.label_id LIMIT 1) IS NOT NULL AND
        (SELECT lp.lng FROM label_point AS lp WHERE lp.label_id = label.label_id LIMIT 1) IS NOT NULL;

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

# --- !Downs
ALTER TABLE label
  DROP COLUMN street_edge_id;
