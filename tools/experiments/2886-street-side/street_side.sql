-- Street-side assignment experiment (#2886). Derived tables for one city schema, built in a scratch schema so the
-- city's own tables are only ever read. Placeholders {exp} (scratch schema) and {city} (city schema) are filled in by
-- street_side.py compute; the SDOT tables it reads (sdot_sidewalk, sdot_curb_ramp) are created by street_side.py load.
--
-- Side convention everywhere: +1 = LEFT of the street edge's digitized direction (ST_StartPoint -> ST_EndPoint),
-- -1 = RIGHT, 0 = exactly on the line. The convention is relative to the edge, not cardinal, because that is what a
-- persisted street_side column would have to be (cardinal sides are undefined on diagonal streets).

SET search_path TO {exp}, {city}, public;

DROP TABLE IF EXISTS label_side, label_frames, label_base, edge_cov, sw_edge_match, sw_sample, label_ramp, edge CASCADE;

-- Which side of a line a point falls on, plus the local road bearing at the point's foot. The sign is computed in a
-- metric projection (UTM 10N) so the lon/lat anisotropy at 47.6 N cannot bias the foot point; the distance is geodesic
-- (CLAUDE.md: never measure by projecting) and the bearing is a true azimuth between two points half a metre either
-- side of the foot, so a curved edge gets its local tangent rather than its chord.
CREATE OR REPLACE FUNCTION {exp}.side_of_point(line_proj geometry, line geometry, pt geometry,
    OUT side smallint, OUT dist_m float8, OUT frac float8, OUT tangent_deg float8)
RETURNS record LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
DECLARE
    p geometry := ST_Transform(pt, 32610);
    len float8 := ST_Length(line_proj);
    eps float8;
    a geometry; b geometry; cp geometry;
    tx float8; ty float8; xprod float8;
BEGIN
    IF len <= 0 THEN
        side := 0; frac := 0; dist_m := ST_Distance(pt::geography, line::geography); tangent_deg := NULL;
        RETURN;
    END IF;
    frac := ST_LineLocatePoint(line_proj, p);
    cp := ST_LineInterpolatePoint(line_proj, frac);
    eps := LEAST(0.5, len / 2) / len;
    a := ST_LineInterpolatePoint(line_proj, GREATEST(frac - eps, 0));
    b := ST_LineInterpolatePoint(line_proj, LEAST(frac + eps, 1));
    tx := ST_X(b) - ST_X(a);
    ty := ST_Y(b) - ST_Y(a);
    xprod := tx * (ST_Y(p) - ST_Y(cp)) - ty * (ST_X(p) - ST_X(cp));
    side := CASE WHEN xprod > 0 THEN 1 WHEN xprod < 0 THEN -1 ELSE 0 END;
    dist_m := ST_Distance(pt::geography, line::geography);
    tangent_deg := degrees(ST_Azimuth(ST_Transform(a, 4326)::geography, ST_Transform(b, 4326)::geography));
END
$fn$;

CREATE OR REPLACE FUNCTION {exp}.compass8(bearing float8) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $fn$
    SELECT (ARRAY['N','NE','E','SE','S','SW','W','NW'])[1 + (floor(((bearing + 22.5)::numeric % 360 + 360) % 360 / 45))::int];
$fn$;

CREATE TABLE edge AS
SELECT street_edge_id, geom, ST_Transform(geom, 32610) AS geom_proj, ST_Length(geom::geography) AS length_m,
       way_type::text AS way_type, status::text AS status
FROM street_edge;
CREATE INDEX ON edge USING gist (geom);
CREATE UNIQUE INDEX ON edge (street_edge_id);

-- One row per real (non-tutorial, non-deleted) label with everything either method needs. label_bearing is the true
-- bearing from the camera to the label, PanoDataService.calculatePovFromPanoXY's heading: the pano is
-- heading-centred, so column x sits at camera_heading - 180 + 360 * x / width.
CREATE TABLE label_base AS
SELECT label.label_id, label_type.label_type, label_point.computation_method::text AS computation_method,
       label.street_edge_id AS audited_edge_id, label.correct, label.agree_count, label.disagree_count,
       label.unsure_count, label.severity, label.time_created, label.user_id, label.pano_id,
       pano_data.source::text AS pano_source, pano_data.lat AS pano_lat, pano_data.lng AS pano_lng,
       pano_data.camera_heading, pano_data.width AS pano_width, pano_data.height AS pano_height,
       label_point.pano_x, label_point.pano_y, label_point.heading AS view_heading, label_point.canvas_x,
       label_point.zoom, label_point.geom AS label_geom,
       CASE WHEN pano_data.lat IS NOT NULL AND pano_data.lng IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(pano_data.lng, pano_data.lat), 4326) END AS pano_geom,
       old_label_point_position.geom AS old_label_geom, old_label_point_position.street_edge_id AS old_edge_id,
       CASE WHEN pano_data.camera_heading IS NOT NULL AND pano_data.width > 0
            THEN ((pano_data.camera_heading - 180 + label_point.pano_x::float8 / pano_data.width * 360)::numeric
                  % 360 + 360) % 360 END AS label_bearing
FROM label
INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
INNER JOIN label_point ON label.label_id = label_point.label_id
LEFT JOIN pano_data ON label.pano_id = pano_data.pano_id
LEFT JOIN old_label_point_position ON label.label_id = old_label_point_position.label_id
WHERE NOT label.tutorial AND NOT label.deleted;
CREATE UNIQUE INDEX ON label_base (label_id);

-- The three street frames a side can be measured in: the street the labeler was auditing, the street nearest the
-- estimated label position, and the street nearest the camera. KNN on degrees is only a shortlist; the pick is by
-- geodesic distance so the lon/lat anisotropy cannot swap a near-tie at a corner.
CREATE TABLE label_frames AS
SELECT label_id, 'audited' AS frame, audited_edge_id AS edge_id FROM label_base
UNION ALL
SELECT b.label_id, 'nearest_label', n.street_edge_id
FROM label_base b
CROSS JOIN LATERAL (
    SELECT c.street_edge_id
    FROM (SELECT street_edge_id, geom FROM edge ORDER BY geom <-> b.label_geom LIMIT 5) c
    ORDER BY ST_Distance(c.geom::geography, b.label_geom::geography) LIMIT 1
) n
WHERE b.label_geom IS NOT NULL
UNION ALL
SELECT b.label_id, 'nearest_pano', n.street_edge_id
FROM label_base b
CROSS JOIN LATERAL (
    SELECT c.street_edge_id
    FROM (SELECT street_edge_id, geom FROM edge ORDER BY geom <-> b.pano_geom LIMIT 5) c
    ORDER BY ST_Distance(c.geom::geography, b.pano_geom::geography) LIMIT 1
) n
WHERE b.pano_geom IS NOT NULL;
CREATE INDEX ON label_frames (label_id);

-- Both methods, in every frame. geo_* is the geometric method (side of the estimated label position); head_* is the
-- heading method (sign of the angle between the camera-to-label bearing and the road bearing at the camera's foot
-- point), which never reads the label position. geo_*_old is the geometric method on the pre-352 approximation2
-- position, for the stability test. axis_angle_deg is the heading method's own margin: 0 means the label ray runs
-- along the road, 90 means it is perpendicular to it.
CREATE TABLE label_side AS
SELECT f.label_id, f.frame, f.edge_id, e.length_m AS edge_length_m, e.way_type, e.status AS edge_status,
       (s.g).side AS geo_side, (s.g).dist_m AS geo_dist_m, (s.g).frac AS geo_frac,
       LEAST((s.g).frac, 1 - (s.g).frac) * e.length_m AS geo_end_dist_m,
       (s.p).side AS pano_side, (s.p).dist_m AS pano_offset_m, (s.p).frac AS pano_frac,
       (s.p).tangent_deg AS road_bearing_deg,
       CASE WHEN b.label_bearing IS NULL OR (s.p).tangent_deg IS NULL THEN NULL
            WHEN sin(radians(b.label_bearing - (s.p).tangent_deg)) < 0 THEN 1
            WHEN sin(radians(b.label_bearing - (s.p).tangent_deg)) > 0 THEN -1 ELSE 0 END::smallint AS head_side,
       degrees(asin(abs(sin(radians(b.label_bearing - (s.p).tangent_deg))))) AS axis_angle_deg,
       (s.o).side AS geo_side_old, (s.o).dist_m AS geo_dist_old_m
FROM label_frames f
INNER JOIN label_base b ON f.label_id = b.label_id
INNER JOIN edge e ON f.edge_id = e.street_edge_id
CROSS JOIN LATERAL (
    SELECT side_of_point(e.geom_proj, e.geom, b.label_geom) AS g,
           side_of_point(e.geom_proj, e.geom, b.pano_geom) AS p,
           side_of_point(e.geom_proj, e.geom, b.old_label_geom) AS o
) s;
CREATE INDEX ON label_side (label_id, frame);

-- SDOT sidewalk inventory, resampled every 4 m so a sidewalk's coverage of a street edge is measured per side and
-- per metre rather than per record. improved = an in-service paved walkway; SDOT also inventories unimproved
-- (UIMPRV/GRAVEL) walkways, which are kept but flagged, because whether a labeler calls one "no sidewalk" is exactly
-- the ambiguity the truth set must stay clear of.
CREATE TABLE sw_sample AS
WITH parts AS (
    SELECT sw.objectid, sw.side AS sdot_side, sw.improved, (d.geom) AS g, d.path[1] AS part
    FROM sdot_sidewalk sw
    CROSS JOIN LATERAL ST_Dump(sw.geom) d
    WHERE sw.geom IS NOT NULL AND GeometryType(d.geom) = 'LINESTRING' AND ST_NumPoints(d.geom) >= 2
), lens AS (
    SELECT *, ST_Length(g::geography) AS len_m FROM parts WHERE ST_Length(g::geography) > 0
), pts AS (
    SELECT objectid, sdot_side, improved, part, len_m, dp.path[1] AS seq, dp.geom AS pt
    FROM lens
    CROSS JOIN LATERAL ST_DumpPoints(ST_LineInterpolatePoints(g, LEAST(1.0, 4.0 / len_m), true)) dp
)
SELECT objectid, sdot_side, improved, part, seq, pt, LEAST(4.0, len_m) AS step_m,
       degrees(ST_Azimuth(pt::geography,
           COALESCE(lead(pt) OVER w, lag(pt) OVER w)::geography)) AS local_az
FROM pts
WINDOW w AS (PARTITION BY objectid, part ORDER BY seq);
CREATE INDEX ON sw_sample USING gist (pt);

-- Each sample attaches to the closest street edge that runs parallel to it (within 30 degrees) and within 18 m; a
-- cross street's edge at a corner is closer but not parallel, so it is skipped rather than credited with the
-- sidewalk. normal_compass is the compass direction from the edge to the sample, checked against SDOT's SIDE.
CREATE TABLE sw_edge_match AS
SELECT s.objectid, s.part, s.seq, s.sdot_side, s.improved, s.step_m,
       n.street_edge_id, (n.sp).side AS side, (n.sp).dist_m AS dist_m, (n.sp).frac AS frac, n.align_deg,
       compass8((n.sp).tangent_deg + CASE WHEN (n.sp).side = 1 THEN -90 ELSE 90 END) AS normal_compass
FROM sw_sample s
CROSS JOIN LATERAL (
    SELECT c.street_edge_id, c.sp,
           abs((((s.local_az - (c.sp).tangent_deg + 90)::numeric % 180 + 180) % 180) - 90) AS align_deg
    FROM (
        SELECT e.street_edge_id, side_of_point(e.geom_proj, e.geom, s.pt) AS sp
        FROM (SELECT * FROM edge ORDER BY geom <-> s.pt LIMIT 4) e
    ) c
    WHERE (c.sp).dist_m <= 18
      AND abs((((s.local_az - (c.sp).tangent_deg + 90)::numeric % 180 + 180) % 180) - 90) <= 30
    ORDER BY (c.sp).dist_m
    LIMIT 1
) n
WHERE s.local_az IS NOT NULL;
CREATE INDEX ON sw_edge_match (street_edge_id);

-- Per-edge sidewalk coverage by side, in metres of sampled sidewalk. The one-sided classification is the ground truth
-- for the side experiment: on an edge with a sidewalk along one side and nothing along the other, a "no sidewalk"
-- label belongs on the bare side and an on-sidewalk label on the paved side, whatever the label's estimated position.
CREATE TABLE edge_cov AS
SELECT e.street_edge_id, e.length_m, e.way_type, e.status,
       COALESCE(sum(m.step_m) FILTER (WHERE m.side = 1 AND m.improved), 0) / NULLIF(e.length_m, 0) AS left_improved,
       COALESCE(sum(m.step_m) FILTER (WHERE m.side = -1 AND m.improved), 0) / NULLIF(e.length_m, 0) AS right_improved,
       COALESCE(sum(m.step_m) FILTER (WHERE m.side = 1 AND NOT m.improved), 0) / NULLIF(e.length_m, 0) AS left_unimproved,
       COALESCE(sum(m.step_m) FILTER (WHERE m.side = -1 AND NOT m.improved), 0) / NULLIF(e.length_m, 0) AS right_unimproved
FROM edge e
LEFT JOIN sw_edge_match m ON e.street_edge_id = m.street_edge_id
GROUP BY e.street_edge_id, e.length_m, e.way_type, e.status;
CREATE UNIQUE INDEX ON edge_cov (street_edge_id);

-- The three SDOT curb-ramp records nearest each curb-ramp-type label, with each ramp's own side of the audited edge.
-- Corners carry ramps on both sides of the street, so the analysis treats a nearest ramp as truth only when no
-- competing ramp on the other side sits within a few metres of the same distance.
CREATE TABLE label_ramp AS
SELECT b.label_id, r.objectid AS ramp_objectid, r.category, r.current_status, r.sw_stside, r.rank,
       r.ramp_dist_m, (r.sp).side AS ramp_side, (r.sp).dist_m AS ramp_edge_dist_m
FROM label_base b
INNER JOIN edge e ON b.audited_edge_id = e.street_edge_id
CROSS JOIN LATERAL (
    SELECT c.objectid, c.category, c.current_status, c.sw_stside,
           ST_Distance(c.geom::geography, b.label_geom::geography) AS ramp_dist_m,
           side_of_point(e.geom_proj, e.geom, c.geom) AS sp,
           row_number() OVER (ORDER BY ST_Distance(c.geom::geography, b.label_geom::geography)) AS rank
    FROM (SELECT * FROM sdot_curb_ramp ORDER BY geom <-> b.label_geom LIMIT 6) c
    WHERE ST_DWithin(c.geom::geography, b.label_geom::geography, 15)
) r
WHERE b.label_type IN ('CurbRamp', 'NoCurbRamp') AND b.label_geom IS NOT NULL AND r.rank <= 3;
CREATE INDEX ON label_ramp (label_id);

-- Nearest paved / unimproved SDOT sidewalk sample on each side of the audited edge, per label, plus how much paved
-- sidewalk the edge carries within 8 m along the street of the label's own foot point. The per-edge coverage class
-- tolerates a 25% gap, so a label can sit in exactly that gap; the local counts let the truth sets require the
-- sidewalk to be present (or absent) where the label actually is.
CREATE TABLE label_sw_near AS
SELECT b.label_id,
       min(ST_Distance(b.label_geom::geography, s.pt::geography)) FILTER (WHERE m.side = 1 AND m.improved)
           AS left_paved_dist_m,
       min(ST_Distance(b.label_geom::geography, s.pt::geography)) FILTER (WHERE m.side = -1 AND m.improved)
           AS right_paved_dist_m,
       min(ST_Distance(b.label_geom::geography, s.pt::geography)) FILTER (WHERE m.side = 1 AND NOT m.improved)
           AS left_unimproved_dist_m,
       min(ST_Distance(b.label_geom::geography, s.pt::geography)) FILTER (WHERE m.side = -1 AND NOT m.improved)
           AS right_unimproved_dist_m,
       count(*) FILTER (WHERE m.side = 1 AND m.improved AND abs(m.frac - ls.geo_frac) * ls.edge_length_m <= 8)
           AS left_paved_local_n,
       count(*) FILTER (WHERE m.side = -1 AND m.improved AND abs(m.frac - ls.geo_frac) * ls.edge_length_m <= 8)
           AS right_paved_local_n,
       count(*) FILTER (WHERE m.side = 1 AND NOT m.improved AND abs(m.frac - ls.geo_frac) * ls.edge_length_m <= 8)
           AS left_unimproved_local_n,
       count(*) FILTER (WHERE m.side = -1 AND NOT m.improved AND abs(m.frac - ls.geo_frac) * ls.edge_length_m <= 8)
           AS right_unimproved_local_n
FROM label_base b
INNER JOIN label_side ls ON b.label_id = ls.label_id AND ls.frame = 'audited'
LEFT JOIN sw_edge_match m ON b.audited_edge_id = m.street_edge_id
LEFT JOIN sw_sample s ON m.objectid = s.objectid AND m.part IS NOT DISTINCT FROM s.part AND m.seq = s.seq
WHERE b.label_geom IS NOT NULL
GROUP BY b.label_id;
CREATE UNIQUE INDEX ON label_sw_near (label_id);
