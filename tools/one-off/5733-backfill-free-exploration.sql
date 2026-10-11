-- =====================================================================
-- Credit the streets that free-exploration sessions walked before per-street tasks existed (#5733). Written against
-- evolution 415 (audit_task.covered_ranges) and the StreetCoverage rule it shipped with; a rerun starts by checking
-- those numbers still match the params row below.
--
-- Before #5733 a drop-in session had one task, for the street it landed on, and nothing credited the streets walked
-- after that. This rebuilds each session's pano trail from audit_task_interaction (PanoId_Changed rows carry the new
-- pano's lat/lng), applies the app's coverage rule per (user, street), and writes what the app would have:
--   * a pano counts for the open street nearest it when that is within 25 m (Task.ON_STREET_MAX_DISTANCE_M)
--   * it covers 10 m either side of its projection onto that street (PanoWindowM)
--   * the stretch to the previous pano counts too when that one was on the same street and the hop is at most 50 m
--     (MaxHopM); a detour off the street breaks the chain
--   * everything a user's free-exploration sessions covered on a street is merged, and the street counts as audited
--     once what is left unseen is at most 50 m (MaxUncoveredM) and at most half the street (MinCoveredFrac)
-- Meters along a street are geodesic lengths of the line up to the pano's projection, the measure the app stores.
--
-- Writes, per (user, street) with any coverage:
--   * the user's own drop-in task on that street, if there is one, gets its coverage, audited_distance_m, and
--     completed (never un-completed); otherwise a task is inserted under the mission of the session that last
--     visited the street, dated by its first and last pano there, as the app now does on a street switch
--   * labels the user placed on that street from a drop-in task on another street move to the street's task, which is
--     where the app now files them; label.street_edge_id already pointed at the street
-- Nothing is deleted. Afterwards recompute street priority (/adminapi/updateStreetPriority), let the nightly
-- region_completion and user-stat jobs run, and rerun clustering where Access Score matters.
--
-- Runs per city: the runner sets search_path and passes the city name. Safe to rerun: a task the first run inserted
-- is found as an existing one the next time, and a moved label is already on its street's task.
--
-- DRY RUN BY DEFAULT: prints one row per planned write and changes nothing. Pass -v apply=1 to write. The runner
-- passes no such variable, so send it a copy with `\set apply 1` in place of `\set apply 0` below. The runner opens
-- connections read-only, which the first statement undoes for the temp table and the writes.
-- =====================================================================
\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?city}
\else
  \set city ''
\endif
SET default_transaction_read_only = off;

CREATE TEMP TABLE plan AS
WITH params AS (
    SELECT 25.0 AS on_street_m, 10.0 AS window_m, 50.0 AS max_hop_m, 50.0 AS max_uncovered_m,
           0.5 AS min_covered_frac
), explore_tasks AS (
    SELECT audit_task.audit_task_id, audit_task.user_id, audit_task.street_edge_id,
           audit_task.current_mission_id AS mission_id
    FROM audit_task
    INNER JOIN mission ON mission.mission_id = audit_task.current_mission_id
    WHERE mission.mission_type = 'exploreAddress'
), trail AS (
    SELECT explore_tasks.audit_task_id,
           explore_tasks.user_id,
           audit_task_interaction.audit_task_interaction_id,
           audit_task_interaction.timestamp,
           audit_task_interaction.lat,
           audit_task_interaction.lng,
           ST_SetSRID(ST_MakePoint(audit_task_interaction.lng, audit_task_interaction.lat), 4326) AS pt
    FROM explore_tasks
    INNER JOIN audit_task_interaction ON audit_task_interaction.audit_task_id = explore_tasks.audit_task_id
    WHERE audit_task_interaction.action = 'PanoId_Changed'
        AND audit_task_interaction.lat IS NOT NULL
        AND audit_task_interaction.lng IS NOT NULL
), located AS (
    -- Each pano on the open street nearest it (the KNN order uses street_edge_geom_idx), if that is close enough.
    SELECT trail.audit_task_id, trail.user_id, trail.audit_task_interaction_id, trail.timestamp, trail.lat, trail.lng,
           nearest.street_edge_id,
           nearest.len_m,
           ST_Length(ST_LineSubstring(nearest.geom, 0, ST_LineLocatePoint(nearest.geom, trail.pt))::geography) AS loc_m
    FROM trail
    CROSS JOIN params
    CROSS JOIN LATERAL (
        SELECT street_edge.street_edge_id, street_edge.geom, ST_Length(street_edge.geom::geography) AS len_m,
               ST_Distance(street_edge.geom::geography, trail.pt::geography) AS off_m
        FROM street_edge
        WHERE street_edge.status = 'open'
            AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
        ORDER BY street_edge.geom <-> trail.pt
        LIMIT 1
    ) AS nearest
    WHERE nearest.off_m <= params.on_street_m
), steps AS (
    -- The previous on-street pano in the same session, whatever street it was on.
    SELECT located.*,
           LAG(street_edge_id) OVER w AS prev_street_edge_id,
           LAG(loc_m) OVER w AS prev_loc_m
    FROM located
    WINDOW w AS (PARTITION BY audit_task_id ORDER BY timestamp, audit_task_interaction_id)
), intervals AS (
    SELECT user_id, street_edge_id, len_m,
           GREATEST(0, loc_m - params.window_m) AS s,
           LEAST(len_m, loc_m + params.window_m) AS e
    FROM steps, params
    UNION ALL
    SELECT user_id, street_edge_id, len_m, LEAST(loc_m, prev_loc_m), GREATEST(loc_m, prev_loc_m)
    FROM steps, params
    WHERE prev_street_edge_id = street_edge_id
        AND ABS(loc_m - prev_loc_m) <= params.max_hop_m
), islands AS (
    -- Merge overlapping intervals per (user, street), across every one of the user's sessions.
    SELECT user_id, street_edge_id, len_m, s, e,
           SUM(CASE WHEN prev_max_e IS NULL OR s > prev_max_e THEN 1 ELSE 0 END)
               OVER (PARTITION BY user_id, street_edge_id ORDER BY s, e ROWS UNBOUNDED PRECEDING) AS island
    FROM (
        SELECT user_id, street_edge_id, len_m, s, e,
               MAX(e) OVER (PARTITION BY user_id, street_edge_id ORDER BY s, e
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_e
        FROM intervals
    ) AS ordered
), merged AS (
    SELECT user_id, street_edge_id, len_m,
           JSONB_AGG(JSONB_BUILD_ARRAY(ROUND(island_s::numeric, 1), ROUND(island_e::numeric, 1)) ORDER BY island_s)
               AS covered_ranges,
           SUM(island_e - island_s) AS covered_m,
           MIN(island_s) AS first_covered_m
    FROM (
        SELECT user_id, street_edge_id, len_m, island, MIN(s) AS island_s, MAX(e) AS island_e
        FROM islands
        GROUP BY user_id, street_edge_id, len_m, island
    ) AS island_bounds
    GROUP BY user_id, street_edge_id, len_m
), visits AS (
    -- When and where the user last stood on the street, for the task row's timestamps and position, and which
    -- session that was, for its mission.
    SELECT user_id, street_edge_id,
           MIN(timestamp) AS first_seen,
           MAX(timestamp) AS last_seen,
           COUNT(*) AS panos,
           (ARRAY_AGG(lat ORDER BY timestamp DESC, audit_task_interaction_id DESC))[1] AS last_lat,
           (ARRAY_AGG(lng ORDER BY timestamp DESC, audit_task_interaction_id DESC))[1] AS last_lng,
           (ARRAY_AGG(audit_task_id ORDER BY timestamp DESC, audit_task_interaction_id DESC))[1] AS last_task_id
    FROM located
    GROUP BY user_id, street_edge_id
), existing AS (
    -- The user's own free-exploration task on that street, if the drop-in made one (newest if several).
    SELECT DISTINCT ON (user_id, street_edge_id) user_id, street_edge_id, audit_task_id
    FROM explore_tasks
    ORDER BY user_id, street_edge_id, audit_task_id DESC
)
SELECT merged.user_id,
       merged.street_edge_id,
       merged.len_m,
       merged.covered_m,
       merged.covered_ranges,
       merged.first_covered_m,
       (merged.len_m - merged.covered_m) <= params.max_uncovered_m
           AND merged.covered_m >= params.min_covered_frac * merged.len_m AS would_complete,
       existing.audit_task_id AS existing_task_id,
       visits.panos,
       visits.first_seen,
       visits.last_seen,
       visits.last_lat,
       visits.last_lng,
       explore_tasks.mission_id,
       NULL::int AS inserted_task_id
FROM merged
CROSS JOIN params
INNER JOIN visits ON visits.user_id = merged.user_id AND visits.street_edge_id = merged.street_edge_id
INNER JOIN explore_tasks ON explore_tasks.audit_task_id = visits.last_task_id
LEFT JOIN existing ON existing.user_id = merged.user_id AND existing.street_edge_id = merged.street_edge_id;
ALTER TABLE plan ADD PRIMARY KEY (user_id, street_edge_id);
ANALYZE plan;

\if :apply
  BEGIN;

  UPDATE audit_task
  SET covered_ranges     = plan.covered_ranges,
      audited_distance_m = plan.covered_m,
      completed          = audit_task.completed OR plan.would_complete,
      task_end           = GREATEST(audit_task.task_end, plan.last_seen)
  FROM plan
  WHERE audit_task.audit_task_id = plan.existing_task_id;

  WITH inserted AS (
    INSERT INTO audit_task (user_id, street_edge_id, task_start, task_end, completed, current_lat, current_lng,
                            start_point_reversed, current_mission_id, low_quality, incomplete, stale,
                            audited_distance_m, start_offset_m, covered_ranges)
    SELECT user_id, street_edge_id, first_seen, last_seen, would_complete, last_lat, last_lng,
           FALSE, mission_id, FALSE, FALSE, FALSE, covered_m, first_covered_m, covered_ranges
    FROM plan
    WHERE existing_task_id IS NULL
    RETURNING audit_task_id, user_id, street_edge_id
  )
  UPDATE plan
  SET inserted_task_id = inserted.audit_task_id
  FROM inserted
  WHERE plan.user_id = inserted.user_id AND plan.street_edge_id = inserted.street_edge_id;

  -- Labels on the street filed under a drop-in task for a different street.
  UPDATE label
  SET audit_task_id = COALESCE(plan.existing_task_id, plan.inserted_task_id)
  FROM plan
  INNER JOIN audit_task AS filed_under ON filed_under.user_id = plan.user_id
  INNER JOIN mission ON mission.mission_id = filed_under.current_mission_id AND mission.mission_type = 'exploreAddress'
  WHERE label.audit_task_id = filed_under.audit_task_id
    AND label.street_edge_id = plan.street_edge_id
    AND filed_under.street_edge_id <> plan.street_edge_id;

  COMMIT;

  SELECT :'city' AS city,
         COUNT(*) FILTER (WHERE existing_task_id IS NOT NULL) AS tasks_updated,
         COUNT(*) FILTER (WHERE inserted_task_id IS NOT NULL) AS tasks_inserted,
         COUNT(*) FILTER (WHERE would_complete) AS streets_completed,
         ROUND(SUM(len_m) FILTER (WHERE would_complete)::numeric) AS completed_m,
         (SELECT COUNT(*) FROM label
          INNER JOIN plan AS p ON p.user_id = label.user_id AND p.street_edge_id = label.street_edge_id
          WHERE label.audit_task_id = COALESCE(p.existing_task_id, p.inserted_task_id)) AS labels_on_street_tasks
  FROM plan;
\else
  SELECT :'city' AS city,
         user_id,
         street_edge_id,
         ROUND(len_m::numeric) AS len_m,
         ROUND(covered_m::numeric, 1) AS covered_m,
         ROUND(GREATEST(0, len_m - covered_m)::numeric, 1) AS uncovered_m,
         would_complete,
         existing_task_id,
         CASE WHEN existing_task_id IS NULL THEN 'insert' ELSE 'update' END AS action,
         panos,
         first_seen,
         last_seen,
         covered_ranges
  FROM plan
  ORDER BY user_id, would_complete DESC, street_edge_id;
\endif
