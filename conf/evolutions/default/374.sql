# --- !Ups
-- Which side of its street a label sits on (#2886), stored as a signed geodesic offset from the centerline of its
-- street_edge_id: positive on the LEFT of the edge's digitized direction, negative on the RIGHT, NULL without a
-- position. The offset is the confidence (right 63-70% under 0.5 m, 97-98% at 1.5-2 m, 99%+ from 3 m against
-- Seattle's SDOT inventory, docs/experiments/2026-09-03-street-side-assignment.md section 5.4), so it is stored
-- rather than just the side. street_side is GENERATED from it with a 1 m floor so the two cannot drift.
CREATE TYPE street_side AS ENUM ('left', 'right');

-- Sign from a cross product against the edge's local tangent (half a metre either side of the foot, so a curved edge
-- gets its tangent, not its chord) in Web Mercator, which is conformal, so no per-city SRID is needed. Magnitude is
-- geodesic, never projected. Double semicolons because Play's evolution parser splits on single ones.
CREATE OR REPLACE FUNCTION label_centerline_offset_m(pt geometry, line geometry) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE STRICT AS
$BODY$
DECLARE
  line_proj geometry := ST_Transform(line, 3857);;
  p geometry := ST_Transform(pt, 3857);;
  len double precision := ST_Length(line_proj);;
  frac double precision;;
  foot geometry;;
  eps double precision;;
  a geometry;;
  b geometry;;
  cross_product double precision;;
BEGIN
  IF len <= 0 THEN
    RETURN NULL;;
  END IF;;
  frac := ST_LineLocatePoint(line_proj, p);;
  foot := ST_LineInterpolatePoint(line_proj, frac);;
  eps := LEAST(0.5, len / 2) / len;;
  a := ST_LineInterpolatePoint(line_proj, GREATEST(frac - eps, 0));;
  b := ST_LineInterpolatePoint(line_proj, LEAST(frac + eps, 1));;
  cross_product := (ST_X(b) - ST_X(a)) * (ST_Y(p) - ST_Y(foot)) - (ST_Y(b) - ST_Y(a)) * (ST_X(p) - ST_X(foot));;
  RETURN SIGN(cross_product) * ST_Distance(pt::geography, line::geography);;
END
$BODY$;

ALTER TABLE label_point
  ADD COLUMN centerline_offset_m double precision,
  ADD COLUMN street_side street_side GENERATED ALWAYS AS (
    CASE
      WHEN centerline_offset_m >= 1 THEN 'left'::street_side
      WHEN centerline_offset_m <= -1 THEN 'right'::street_side
    END
  ) STORED;

-- One pass over label_point hash-joined to label and street_edge on their primary keys. The function dominates at
-- about 8 us per label (2.5 s for Seattle's 317k positioned labels on the dev DB) plus the row rewrite. Anything
-- that later moves label_point.geom or changes label.street_edge_id must recompute this column (docs/evolutions.md).
UPDATE label_point
SET centerline_offset_m = label_centerline_offset_m(label_point.geom, street_edge.geom)
FROM label, street_edge
WHERE label.label_id = label_point.label_id
  AND street_edge.street_edge_id = label.street_edge_id
  AND label_point.geom IS NOT NULL;

# --- !Downs
ALTER TABLE label_point
  DROP COLUMN street_side,
  DROP COLUMN centerline_offset_m;
DROP FUNCTION label_centerline_offset_m(geometry, geometry);
DROP TYPE street_side;
