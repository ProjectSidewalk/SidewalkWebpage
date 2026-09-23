-- =====================================================================
-- Find duplicate streets (#3067): one row per pair of street_edge rows drawn on top of each other, with which one
-- merge_duplicate_streets.sql would drop and everything riding on each side. Read-only; run it to look at a city
-- before applying the merge. Pairs where one road passes over or under the other are listed with stacked = t and
-- are never merged.
--
-- READ-ONLY. SAFE TO RUN ON PROD. ~30s on the largest schema (Chicago, 331k streets), a few seconds on the rest.
-- Built for sidewalk-server-tools/run-query-in-every-city.sh (-m), which sets the search_path and the city variable.
-- Margins are overridable: -v tol_m=, -v min_len_m=, -v min_cov=. The detection and the keep/drop rules must stay
-- the same as merge_duplicate_streets.sql's, which explains them.
--
-- Reading the output:
--   * stacked: OSM says one is a bridge or tunnel, or they're on different layers -- a road passing over another,
--     not a copy. The merge never touches these.
--   * a_in_b / b_in_a: the share of each street inside a 0.5m corridor around the other; listed when either reaches
--     80%. Both ~1.00 means twins; one ~1.00 and the other lower means that one is a piece of the longer street.
--   * a_sep_m / b_sep_m: how far the street runs from the other, averaged over 10 points. Read the one belonging to
--     the street with the high coverage.
--   * a_name / b_name: the OSM name of each side. Matching names are almost certainly one road entered twice;
--     different names deserve a look first.
--   * a_ways_gone / b_ways_gone: how many of the street's OSM ways are no longer roads there -- deleted, or kept
--     only as an untagged line. A street whose ways are all gone is the one OSM itself called the duplicate (what
--     happened in Columbus), and that decides which twin to drop.
--   * pair_hint / drop_hint: which street to drop judged on this pair alone, then after the merge's max_gap_m check.
--     drop_hint matches the merge except where three or more streets sit on each other: the merge follows those
--     through to one street and this doesn't, so a hint there can name a street that is itself dropped.
--   * a_best_region_id / b_best_region_id: the live region holding most of each street's length; the kept street
--     goes there, fixing the copies our import made where two region shapes overlapped.
--
\if :{?tol_m}
\else
  \set tol_m 0.5
\endif
\if :{?min_len_m}
\else
  \set min_len_m 10.0
\endif
\if :{?min_cov}
\else
  \set min_cov 0.80
\endif
\if :{?max_gap_m}
\else
  \set max_gap_m 20.0
\endif
WITH scored AS MATERIALIZED (
  -- MATERIALIZED so the corridor maths runs once per pair, not once per use below (10 min instead of 30s).
  -- Longitude is squashed by cos(latitude) so the corridor is round rather than an oval.
  SELECT street_a.street_edge_id AS street_a_id, street_b.street_edge_id AS street_b_id,
         ST_Length(ST_Intersection(flat.geom_a, ST_Buffer(flat.geom_b, flat.tol_deg, 'quad_segs=4')))
           / NULLIF(ST_Length(flat.geom_a), 0) AS a_in_b,
         ST_Length(ST_Intersection(flat.geom_b, ST_Buffer(flat.geom_a, flat.tol_deg, 'quad_segs=4')))
           / NULLIF(ST_Length(flat.geom_b), 0) AS b_in_a
  FROM street_edge AS street_a
  JOIN street_edge AS street_b
    ON street_a.street_edge_id < street_b.street_edge_id
   AND street_a.geom && ST_Expand(street_b.geom, 0.00010)
  CROSS JOIN LATERAL (
    SELECT ST_Scale(street_a.geom, cos(radians(ST_Y(ST_StartPoint(street_a.geom)))), 1.0) AS geom_a,
           ST_Scale(street_b.geom, cos(radians(ST_Y(ST_StartPoint(street_a.geom)))), 1.0) AS geom_b,
           :tol_m / 111320.0 AS tol_deg
  ) AS flat
  -- The tutorial street is shared by every user's tutorial, so the merge never touches it.
  WHERE street_a.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
    AND street_b.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
),
-- Untagged or unfetched ways read as ground level.
street_tags AS (
  SELECT osm_way_street_edge.street_edge_id,
         bool_or(coalesce(osm_way.tags ->> 'bridge', 'no') <> 'no') AS is_bridge,
         bool_or(coalesce(osm_way.tags ->> 'tunnel', 'no') <> 'no') AS is_tunnel,
         -- OSM layer values are free text, so anything that isn't a plain integer is left out rather than cast.
         max(CASE WHEN osm_way.tags ->> 'layer' ~ '^-?[0-9]+$' THEN (osm_way.tags ->> 'layer')::int END) AS layer,
         string_agg(DISTINCT osm_way.tags ->> 'name', '; ') AS names
  FROM osm_way_street_edge
  JOIN osm_way ON osm_way.osm_way_id = osm_way_street_edge.osm_way_id
  GROUP BY osm_way_street_edge.street_edge_id
),
dup_pair AS (
  SELECT scored.street_a_id, scored.street_b_id, scored.a_in_b, scored.b_in_a,
         edge_a.geom AS a_geom, edge_b.geom AS b_geom,
         ST_Length(edge_a.geom::geography) AS a_len_m, ST_Length(edge_b.geom::geography) AS b_len_m,
         ST_Equals(edge_a.geom, edge_b.geom) AS same_geom,
         edge_a.status::text AS a_status, edge_b.status::text AS b_status,
         edge_a.way_type::text AS a_way_type, edge_b.way_type::text AS b_way_type,
         coalesce(tags_a.is_bridge, FALSE) <> coalesce(tags_b.is_bridge, FALSE)
           OR coalesce(tags_a.is_tunnel, FALSE) <> coalesce(tags_b.is_tunnel, FALSE)
           OR coalesce(tags_a.layer, 0) <> coalesce(tags_b.layer, 0) AS stacked,
         tags_a.names AS a_name, tags_b.names AS b_name,
         coalesce(tags_a.is_bridge, FALSE) AS a_bridge, coalesce(tags_b.is_bridge, FALSE) AS b_bridge,
         coalesce(tags_a.is_tunnel, FALSE) AS a_tunnel, coalesce(tags_b.is_tunnel, FALSE) AS b_tunnel,
         tags_a.layer AS a_layer, tags_b.layer AS b_layer,
         (SELECT avg(ST_Distance(ST_LineInterpolatePoint(edge_a.geom, step / 20.0)::geography, edge_b.geom::geography))
            FROM generate_series(1, 19, 2) AS step) AS a_sep_m,
         (SELECT avg(ST_Distance(ST_LineInterpolatePoint(edge_b.geom, step / 20.0)::geography, edge_a.geom::geography))
            FROM generate_series(1, 19, 2) AS step) AS b_sep_m
  FROM scored
  JOIN street_edge AS edge_a ON edge_a.street_edge_id = scored.street_a_id
  JOIN street_edge AS edge_b ON edge_b.street_edge_id = scored.street_b_id
  LEFT JOIN street_tags AS tags_a ON tags_a.street_edge_id = scored.street_a_id
  LEFT JOIN street_tags AS tags_b ON tags_b.street_edge_id = scored.street_b_id
  WHERE greatest(scored.a_in_b, scored.b_in_a) >= :min_cov
    AND ST_Length(edge_a.geom::geography) >= :min_len_m
    AND ST_Length(edge_b.geom::geography) >= :min_len_m
),
street_data AS (
  SELECT street_edge.street_edge_id,
         (SELECT region.region_id FROM street_edge_region
           JOIN region ON region.region_id = street_edge_region.region_id
           WHERE street_edge_region.street_edge_id = street_edge.street_edge_id LIMIT 1) AS region_id,
         (SELECT region.name FROM street_edge_region
           JOIN region ON region.region_id = street_edge_region.region_id
           WHERE street_edge_region.street_edge_id = street_edge.street_edge_id LIMIT 1) AS region_name,
         -- Where the street belongs if it is the one kept. Deleted regions are hidden everywhere in the app, so a
         -- street left in one would vanish from the site.
         (SELECT region.region_id FROM region
           WHERE region.geom && street_edge.geom AND NOT region.deleted
           ORDER BY ST_Length(ST_Intersection(street_edge.geom, region.geom)::geography) DESC, region.region_id
           LIMIT 1) AS best_region_id,
         (SELECT string_agg(osm_way_id::text, ' ' ORDER BY osm_way_id) FROM osm_way_street_edge
           WHERE osm_way_street_edge.street_edge_id = street_edge.street_edge_id) AS osm_ways,
         -- Rows exist only once the nightly refresh fetched the way, so empty tags mean untagged, not unknown.
         -- missing_since goes through to_jsonb so a schema behind evolution 382 still parses.
         (SELECT count(*) FROM osm_way_street_edge
           JOIN osm_way ON osm_way.osm_way_id = osm_way_street_edge.osm_way_id
           WHERE osm_way_street_edge.street_edge_id = street_edge.street_edge_id
             AND (to_jsonb(osm_way) ->> 'missing_since' IS NOT NULL OR NOT osm_way.tags ? 'highway')) AS ways_gone,
         (SELECT count(*) FROM osm_way_street_edge
           WHERE osm_way_street_edge.street_edge_id = street_edge.street_edge_id) AS ways_total,
         (SELECT count(*) FROM label
           WHERE label.street_edge_id = street_edge.street_edge_id AND label.deleted = FALSE) AS n_labels,
         (SELECT count(*) FROM audit_task
           WHERE audit_task.street_edge_id = street_edge.street_edge_id) AS n_audit_tasks,
         (SELECT count(*) FROM audit_task
           WHERE audit_task.street_edge_id = street_edge.street_edge_id AND audit_task.completed) AS n_audits_done,
         (SELECT count(*) FROM route_street
           WHERE route_street.street_edge_id = street_edge.street_edge_id) AS n_route_streets,
         (SELECT count(*) FROM street_edge_issue
           WHERE street_edge_issue.street_edge_id = street_edge.street_edge_id) AS n_issues
  FROM street_edge
  WHERE street_edge.street_edge_id IN (SELECT street_a_id FROM dup_pair UNION SELECT street_b_id FROM dup_pair)
)
,
listed AS (
SELECT :'city' AS city, dup_pair.street_a_id, dup_pair.street_b_id, dup_pair.stacked,
       round(dup_pair.a_len_m::numeric, 1) AS a_len_m, round(dup_pair.b_len_m::numeric, 1) AS b_len_m,
       round(dup_pair.a_in_b::numeric, 3) AS a_in_b, round(dup_pair.b_in_a::numeric, 3) AS b_in_a,
       round(dup_pair.a_sep_m::numeric, 2) AS a_sep_m, round(dup_pair.b_sep_m::numeric, 2) AS b_sep_m,
       dup_pair.same_geom,
       data_a.osm_ways = data_b.osm_ways AS same_osm_ways,
       dup_pair.a_name, dup_pair.b_name,
       dup_pair.a_bridge, dup_pair.b_bridge, dup_pair.a_tunnel, dup_pair.b_tunnel,
       dup_pair.a_layer, dup_pair.b_layer,
       dup_pair.a_status, dup_pair.b_status, dup_pair.a_way_type, dup_pair.b_way_type,
       data_a.region_id AS a_region_id, data_b.region_id AS b_region_id,
       data_a.region_name AS a_region_name, data_b.region_name AS b_region_name,
       data_a.osm_ways AS a_osm_ways, data_b.osm_ways AS b_osm_ways,
       data_a.ways_gone AS a_ways_gone, data_a.ways_total AS a_ways_total,
       data_b.ways_gone AS b_ways_gone, data_b.ways_total AS b_ways_total,
       data_a.n_labels AS a_labels, data_b.n_labels AS b_labels,
       data_a.n_audit_tasks AS a_audit_tasks, data_b.n_audit_tasks AS b_audit_tasks,
       data_a.n_audits_done AS a_audits_done, data_b.n_audits_done AS b_audits_done,
       data_a.n_route_streets AS a_route_streets, data_b.n_route_streets AS b_route_streets,
       data_a.n_issues AS a_issues, data_b.n_issues AS b_issues,
       -- Somewhere to click: the middle of the shorter street, as a lat/lng for LabelMap's ?lat/?lng/?zoom or OSM.
       round(ST_Y(ST_LineInterpolatePoint(CASE WHEN dup_pair.a_len_m <= dup_pair.b_len_m
                                               THEN dup_pair.a_geom ELSE dup_pair.b_geom END, 0.5))::numeric, 6)
         || ',' ||
       round(ST_X(ST_LineInterpolatePoint(CASE WHEN dup_pair.a_len_m <= dup_pair.b_len_m
                                               THEN dup_pair.a_geom ELSE dup_pair.b_geom END, 0.5))::numeric, 6)
         AS midpoint_latlng,
       -- Must stay in step with merge_duplicate_streets.sql's rules, which its header explains.
       CASE
         WHEN dup_pair.stacked THEN 'neither: one is over or under the other'
         WHEN dup_pair.a_status = 'open' AND dup_pair.b_status <> 'open' THEN 'drop B: only A is open'
         WHEN dup_pair.b_status = 'open' AND dup_pair.a_status <> 'open' THEN 'drop A: only B is open'
         WHEN dup_pair.b_in_a < :min_cov THEN 'drop A: part of B'
         WHEN dup_pair.a_in_b < :min_cov THEN 'drop B: part of A'
         WHEN data_a.ways_total > 0 AND data_a.ways_gone = data_a.ways_total
              AND NOT (data_b.ways_total > 0 AND data_b.ways_gone = data_b.ways_total)
           THEN 'drop A: no longer a road in OSM'
         WHEN data_b.ways_total > 0 AND data_b.ways_gone = data_b.ways_total
              AND NOT (data_a.ways_total > 0 AND data_a.ways_gone = data_a.ways_total)
           THEN 'drop B: no longer a road in OSM'
         WHEN data_a.n_labels + data_a.n_audit_tasks < data_b.n_labels + data_b.n_audit_tasks
           THEN 'drop A: twin with less data'
         WHEN data_b.n_labels + data_b.n_audit_tasks < data_a.n_labels + data_a.n_audit_tasks
           THEN 'drop B: twin with less data'
         WHEN data_a.region_id = data_a.best_region_id AND data_b.region_id IS DISTINCT FROM data_b.best_region_id
           THEN 'drop B: twin, A already in its region'
         WHEN data_b.region_id = data_b.best_region_id AND data_a.region_id IS DISTINCT FROM data_a.best_region_id
           THEN 'drop A: twin, B already in its region'
         ELSE 'drop B: twin, no tiebreak (newer id)'
       END AS pair_hint,
       data_a.best_region_id AS a_best_region_id, data_b.best_region_id AS b_best_region_id
FROM dup_pair
JOIN street_data AS data_a ON data_a.street_edge_id = dup_pair.street_a_id
JOIN street_data AS data_b ON data_b.street_edge_id = dup_pair.street_b_id
),
-- The merge keeps a street when its best partner leaves more than max_gap_m of it uncovered.
dropped_gap AS (
  SELECT DISTINCT ON (dropped_edge.street_edge_id) dropped_edge.street_edge_id, gap.gap_m
  FROM listed
  JOIN street_edge AS dropped_edge
    ON dropped_edge.street_edge_id = CASE WHEN listed.pair_hint LIKE 'drop A%' THEN listed.street_a_id
                                          ELSE listed.street_b_id END
  JOIN street_edge AS kept_edge
    ON kept_edge.street_edge_id = CASE WHEN listed.pair_hint LIKE 'drop A%' THEN listed.street_b_id
                                       ELSE listed.street_a_id END
  CROSS JOIN LATERAL (
    SELECT ST_Scale(dropped_edge.geom, cos(radians(ST_Y(ST_StartPoint(dropped_edge.geom)))), 1.0) AS dropped,
           ST_Scale(kept_edge.geom, cos(radians(ST_Y(ST_StartPoint(dropped_edge.geom)))), 1.0) AS kept
  ) AS flat
  CROSS JOIN LATERAL (
    SELECT (1 - ST_Length(ST_Intersection(flat.dropped, ST_Buffer(flat.kept, :tol_m / 111320.0, 'quad_segs=4')))
                  / NULLIF(ST_Length(flat.dropped), 0)) * ST_Length(dropped_edge.geom::geography) AS gap_m
  ) AS gap
  WHERE listed.pair_hint LIKE 'drop%'
  ORDER BY dropped_edge.street_edge_id, gap.gap_m, kept_edge.street_edge_id
)
SELECT listed.*,
       CASE WHEN dropped_gap.gap_m > :max_gap_m
              THEN 'neither: the street replacing it leaves ' || round(dropped_gap.gap_m::numeric) || 'm uncovered'
            ELSE listed.pair_hint END AS drop_hint
FROM listed
LEFT JOIN dropped_gap
  ON dropped_gap.street_edge_id = CASE WHEN listed.pair_hint LIKE 'drop A%' THEN listed.street_a_id
                                       WHEN listed.pair_hint LIKE 'drop B%' THEN listed.street_b_id END
ORDER BY listed.stacked, least(listed.a_len_m, listed.b_len_m) DESC;
