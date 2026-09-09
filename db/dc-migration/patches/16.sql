-- Patched mainline 16.sql for the DC migration (issue #4700): the mission model rewrite, with DC's legacy missions
-- reconstructed instead of truncated.
--
-- Mainline 16 TRUNCATEs label, label_tag, user_attribute_label and the audit_task_* side tables so it can add
-- mission_id INT NOT NULL columns to empty tables. Here every row is kept: the new mission model is created, then
-- the missions DC's users actually experienced are rebuilt from the evidence the legacy database holds, and every
-- label / interaction / environment / incomplete / comment row is placed into one by (user, timestamp).
--
-- What a legacy DC mission was (2018 code, `git show 02ed65161:app/models/mission/MissionTable.scala` and
-- `.../SVLabel/mission/MissionProgress.js`): per region, a ladder of cumulative-distance milestones (500 ft,
-- 1000 ft [twice, #841], 2000 ft, 4000 ft, 1 mi, then every half mile up to the region's total) plus one
-- area-coverage milestone and 'onboarding'. The client tracked the user's distance in the current region
-- continuously and, the moment a milestone was crossed (mid-street, like a modern mission), logged a
-- `MissionComplete` interaction (label, distance, neighborhoodId) and saved a `mission_user` row (Turkers:
-- pay_per_mile 4.17). Milestones already exceeded were completed silently and the server back-marked missions at
-- page load, so `mission_user` also holds completions with no event. The app showed mission k as the chunk
-- threshold_k - threshold_(k-1), and Turker pay was chunk miles x pay_per_mile.
--
-- Rules (Mikey, 2026-09-03):
--   * milestones = logged events (authoritative) + mission_user rows without an event (timestamped by replaying
--     the user's distance in that region, interpolated inside the crossing task; unreachable ones sit at the
--     user's last task there, flagged) + simulated ladder crossings for work that predates the first logged
--     event (2016-09-22), when the log simply did not record completions;
--   * a mission's region_id is the (preclean-chosen) region of the street being audited when the milestone fired;
--     the event's neighborhoodId only says which ladder and pay record apply;
--   * milestones within 5 s of each other are one mission (two thresholds crossed at once); a milestone that
--     does not exceed the user's running maximum on that ladder is a duplicate and is dropped;
--   * only real mission_user rows carry pay/paid; simulated missions are 0/unpaid;
--   * every synthesized mission is completed (a tail after the last milestone becomes one completed mission with
--     its real progress) so nothing gets resumed on a user's next visit;
--   * one completed auditOnboarding mission per user with an Onboarding_End event or a legacy onboarding row;
--     tutorial labels (22.sql's criterion) belong to it.
-- Inputs beyond the city tables: dc_migration_event and dc_migration_label_time, loaded by 16.pre.sql from the
-- interaction-log extracts (harness/extract-events.sh).
SET search_path TO sidewalk, public;

-- ---------------------------------------------------------------------------------------------------------------
-- Part 1. Keep the legacy tables' contents, then build mainline 16's model.
CREATE TABLE dc_migration_legacy_mission AS SELECT * FROM mission;
CREATE TABLE dc_migration_legacy_mission_user AS SELECT * FROM mission_user;
DROP TABLE mission_user;
DROP TABLE mission;

CREATE TABLE mission_type
(
  mission_type_id SERIAL NOT NULL,
  mission_type TEXT NOT NULL,
  PRIMARY KEY (mission_type_id)
);
INSERT INTO mission_type (mission_type) VALUES ( 'auditOnboarding' );
INSERT INTO mission_type (mission_type) VALUES ( 'audit' );
INSERT INTO mission_type (mission_type) VALUES ( 'validationOnboarding' );
INSERT INTO mission_type (mission_type) VALUES ( 'validation' );

-- Same shape as mainline 16, except mission_start/mission_end are TIMESTAMPTZ (with the DEFAULT now() mainline 26
-- adds) from the start: the values below come from TIMESTAMPTZ columns, and running them through 26.sql's
-- naive-timestamp conversion would corrupt them, so patches/26.sql skips the mission block. 281 relies on the defaults.
CREATE TABLE mission
(
  mission_id SERIAL NOT NULL,
  mission_type_id INT NOT NULL,
  user_id TEXT NOT NULL,
  mission_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  mission_end TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed BOOLEAN NOT NULL,
  pay REAL NOT NULL DEFAULT 0.0,
  paid BOOLEAN NOT NULL,
  distance_meters DOUBLE PRECISION,
  distance_progress DOUBLE PRECISION,
  region_id INT,
  labels_validated INT,
  labels_progress INT,
  skipped BOOLEAN NOT NULL,
  PRIMARY KEY (mission_id),
  FOREIGN KEY (mission_type_id) REFERENCES mission_type(mission_type_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk.user(user_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Part 2. Evidence.

-- Tasks: chosen region, street length, and a sane time window (2,337 legacy rows have task_end before task_start).
CREATE TEMP TABLE dc_task AS
SELECT audit_task.audit_task_id, audit_task.user_id, audit_task.street_edge_id, street_edge_region.region_id,
       LEAST(audit_task.task_start, audit_task.task_end) AS t0,
       GREATEST(audit_task.task_start, audit_task.task_end) AS t1,
       ST_Length(street_edge.geom::geography) AS len_m
FROM audit_task
JOIN street_edge ON street_edge.street_edge_id = audit_task.street_edge_id
LEFT JOIN street_edge_region ON street_edge_region.street_edge_id = audit_task.street_edge_id;
CREATE INDEX ON dc_task (audit_task_id);
CREATE INDEX ON dc_task (user_id, t1);

-- Every region a street belonged to before preclean picked one: the legacy client counted a street toward whichever
-- region the user was auditing under, and the ladders it crossed are only reproducible on that basis.
CREATE TEMP TABLE dc_street_any_region AS
SELECT street_edge_id, region_id FROM street_edge_region
UNION
SELECT street_edge_id, region_id FROM dc_migration_street_region_dropped;
CREATE INDEX ON dc_street_any_region (street_edge_id);

CREATE TEMP TABLE dc_ladder AS
SELECT legacy_mission_id, region_id, label, distance, level,
       -- what the app showed and paid for the rung: its distance minus the rung before it in distance order (the
       -- doubled 1000 ft rung from #841 therefore pays 0 for its second copy, as it did live)
       distance - COALESCE(LAG(distance) OVER (PARTITION BY region_id ORDER BY distance, legacy_mission_id), 0) AS rung_m
FROM (SELECT mission_id AS legacy_mission_id, region_id, label, distance, level FROM dc_migration_legacy_mission
      WHERE NOT deleted AND label IN ('distance-mission', 'area-coverage-mission') AND region_id IS NOT NULL AND distance IS NOT NULL) l;
CREATE INDEX ON dc_ladder (region_id, label, distance);

-- Logged completions, one per (user, ladder region, label, distance): the earliest event wins.
CREATE TEMP TABLE dc_event_milestone AS
SELECT DISTINCT ON (dc_task.user_id, note_region_id, mission_label, ROUND(mission_distance::numeric, 1))
       dc_task.user_id, ev.audit_task_id, dc_task.region_id AS street_region_id, ev.timestamp AS ts,
       note_region_id AS ladder_region_id, mission_label, mission_distance
FROM (
  SELECT audit_task_id, timestamp,
         lower((regexp_match(note, 'missionLabel:([^,]+)', 'i'))[1]) AS mission_label,
         (regexp_match(note, 'missionDistance:([0-9.]+)', 'i'))[1]::double precision AS mission_distance,
         (regexp_match(note, 'neighborhoodId:([0-9]+)', 'i'))[1]::int AS note_region_id
  FROM dc_migration_event WHERE action = 'MissionComplete'
) ev
JOIN dc_task ON dc_task.audit_task_id = ev.audit_task_id
WHERE mission_distance IS NOT NULL AND note_region_id IS NOT NULL
ORDER BY dc_task.user_id, note_region_id, mission_label, ROUND(mission_distance::numeric, 1), ev.timestamp;

CREATE TEMP TABLE dc_mu_milestone AS
SELECT mu.mission_user_id, mu.user_id, mu.paid, mu.pay_per_mile,
       l.legacy_mission_id, l.region_id AS ladder_region_id, l.label AS mission_label, l.distance AS mission_distance
FROM dc_migration_legacy_mission_user mu
JOIN dc_ladder l ON l.legacy_mission_id = mu.mission_id;

-- Cumulative distance per (user, region-as-the-client-counted-it), in task order: the replay that timestamps
-- completions the log never recorded.
CREATE TEMP TABLE dc_cum AS
SELECT dc_task.user_id, r.region_id AS ladder_region_id, dc_task.audit_task_id, dc_task.region_id AS street_region_id,
       dc_task.t0, dc_task.t1, dc_task.len_m,
       COALESCE(SUM(dc_task.len_m) OVER (PARTITION BY dc_task.user_id, r.region_id ORDER BY dc_task.t0, dc_task.audit_task_id
                                          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS cum_before
FROM dc_task
JOIN dc_street_any_region r ON r.street_edge_id = dc_task.street_edge_id;
CREATE INDEX ON dc_cum (user_id, ladder_region_id, cum_before);

-- A ladder crossing's moment: linear inside the task whose window contains the threshold.
CREATE OR REPLACE FUNCTION pg_temp.dc_crossing(p_user TEXT, p_region INT, p_distance DOUBLE PRECISION,
                                                OUT ts TIMESTAMPTZ, OUT audit_task_id INT, OUT street_region_id INT)
RETURNS record LANGUAGE sql STABLE AS $$
  SELECT t0 + (t1 - t0) * LEAST(1.0, GREATEST(0.0, (p_distance - cum_before) / NULLIF(len_m, 0))), audit_task_id, street_region_id
  FROM dc_cum
  WHERE user_id = p_user AND ladder_region_id = p_region AND cum_before < p_distance AND cum_before + len_m >= p_distance
  ORDER BY t0, audit_task_id LIMIT 1
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Part 3. Milestones from all three sources, then missions.
CREATE TABLE dc_migration_milestone (
  milestone_id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  ladder_region_id INT NOT NULL,
  mission_label TEXT NOT NULL,
  mission_distance DOUBLE PRECISION NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  street_region_id INT,
  audit_task_id INT,
  source TEXT NOT NULL,              -- event | mission_user | simulated
  unplaced BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_mission_id INT,
  legacy_mission_user_id INT,
  paid BOOLEAN,
  pay_per_mile DOUBLE PRECISION,
  mission_id INT                     -- filled once missions exist
);

-- 3a. Events, joined to their ladder row (tolerance covers float formatting) and to the matching mission_user row.
INSERT INTO dc_migration_milestone (user_id, ladder_region_id, mission_label, mission_distance, ts, street_region_id, audit_task_id, source,
                                    legacy_mission_id, legacy_mission_user_id, paid, pay_per_mile)
SELECT e.user_id, e.ladder_region_id, e.mission_label, e.mission_distance, e.ts, e.street_region_id, e.audit_task_id, 'event',
       l.legacy_mission_id, mu.mission_user_id, mu.paid, mu.pay_per_mile
FROM dc_event_milestone e
LEFT JOIN LATERAL (
  SELECT legacy_mission_id FROM dc_ladder
  WHERE dc_ladder.region_id = e.ladder_region_id AND dc_ladder.label = e.mission_label
    AND ABS(dc_ladder.distance - e.mission_distance) < 0.5
  ORDER BY legacy_mission_id LIMIT 1) l ON TRUE
LEFT JOIN LATERAL (
  SELECT mission_user_id, paid, pay_per_mile FROM dc_mu_milestone
  WHERE dc_mu_milestone.user_id = e.user_id AND dc_mu_milestone.legacy_mission_id = l.legacy_mission_id
  ORDER BY mission_user_id LIMIT 1) mu ON TRUE;

-- 3b. mission_user rows no event covers: timestamp by replay; never-reached ones sit at the user's last task in that
-- region (or, with no task there at all, their last task anywhere), flagged.
INSERT INTO dc_migration_milestone (user_id, ladder_region_id, mission_label, mission_distance, ts, street_region_id, audit_task_id, source,
                                    unplaced, legacy_mission_id, legacy_mission_user_id, paid, pay_per_mile)
SELECT mu.user_id, mu.ladder_region_id, mu.mission_label, mu.mission_distance,
       COALESCE(x.ts, last_there.t1, last_any.t1),
       COALESCE(x.street_region_id, last_there.street_region_id, last_any.region_id),
       COALESCE(x.audit_task_id, last_there.audit_task_id, last_any.audit_task_id),
       'mission_user', x.ts IS NULL, mu.legacy_mission_id, mu.mission_user_id, mu.paid, mu.pay_per_mile
FROM dc_mu_milestone mu
LEFT JOIN LATERAL (SELECT * FROM pg_temp.dc_crossing(mu.user_id, mu.ladder_region_id, mu.mission_distance)) x ON TRUE
LEFT JOIN LATERAL (SELECT t1, street_region_id, audit_task_id FROM dc_cum
                   WHERE dc_cum.user_id = mu.user_id AND dc_cum.ladder_region_id = mu.ladder_region_id
                   ORDER BY t1 DESC LIMIT 1) last_there ON TRUE
LEFT JOIN LATERAL (SELECT t1, region_id, audit_task_id FROM dc_task
                   WHERE dc_task.user_id = mu.user_id ORDER BY t1 DESC LIMIT 1) last_any ON TRUE
WHERE NOT EXISTS (SELECT 1 FROM dc_migration_milestone m
                  WHERE m.user_id = mu.user_id AND m.legacy_mission_id = mu.legacy_mission_id)
  AND COALESCE(x.ts, last_there.t1, last_any.t1) IS NOT NULL;

-- 3c. Before the log recorded completions (first event 2016-09-22), trust the replay: every ladder crossing that
-- happened before that moment, on ladders the log never spoke for (a user-region with events has its history
-- already; mixing in replayed crossings there only contradicts it) and that mission_user does not already hold.
INSERT INTO dc_migration_milestone (user_id, ladder_region_id, mission_label, mission_distance, ts, street_region_id, audit_task_id, source,
                                    legacy_mission_id)
SELECT c.user_id, c.ladder_region_id, l.label, l.distance, x.ts, x.street_region_id, x.audit_task_id, 'simulated', l.legacy_mission_id
FROM (SELECT DISTINCT user_id, ladder_region_id FROM dc_cum) c
JOIN dc_ladder l ON l.region_id = c.ladder_region_id AND l.label = 'distance-mission'
JOIN LATERAL (SELECT * FROM pg_temp.dc_crossing(c.user_id, c.ladder_region_id, l.distance)) x ON TRUE
WHERE x.ts < (SELECT MIN(timestamp) FROM dc_migration_event WHERE action = 'MissionComplete')
  AND NOT EXISTS (SELECT 1 FROM dc_event_milestone e WHERE e.user_id = c.user_id AND e.ladder_region_id = c.ladder_region_id)
  AND NOT EXISTS (SELECT 1 FROM dc_migration_milestone m
                  WHERE m.user_id = c.user_id AND m.ladder_region_id = c.ladder_region_id
                    AND m.mission_label = l.label AND ABS(m.mission_distance - l.distance) < 0.5);

CREATE INDEX ON dc_migration_milestone (user_id, ts);

-- The replay counts whole street lengths, so it tends to reach a threshold earlier than the app did. Where a ladder
-- also has logged events, they are the truth about order: a replayed milestone below an event was completed no
-- later than that event (the app's silent catch-up), one above it no earlier. Clamp to the nearest events; a
-- clamped milestone lands inside that event's burst and merges into its mission.
UPDATE dc_migration_milestone m
SET ts = GREATEST(LEAST(m.ts, above.ts - interval '1 second'), below.ts + interval '1 second')
FROM dc_migration_milestone m2
LEFT JOIN LATERAL (SELECT ts FROM dc_migration_milestone e WHERE e.source = 'event' AND e.user_id = m2.user_id
                   AND e.ladder_region_id = m2.ladder_region_id AND e.mission_distance < m2.mission_distance
                   ORDER BY e.mission_distance DESC LIMIT 1) below ON TRUE
LEFT JOIN LATERAL (SELECT ts FROM dc_migration_milestone e WHERE e.source = 'event' AND e.user_id = m2.user_id
                   AND e.ladder_region_id = m2.ladder_region_id AND e.mission_distance > m2.mission_distance
                   ORDER BY e.mission_distance ASC LIMIT 1) above ON TRUE
WHERE m.milestone_id = m2.milestone_id AND m2.source <> 'event'
  AND (below.ts IS NOT NULL OR above.ts IS NOT NULL)
  AND (m2.ts <= COALESCE(below.ts, '-infinity') OR m2.ts >= COALESCE(above.ts, 'infinity'));

-- 3d. Order each user's milestones in time; drop the ones that don't raise the running maximum of their ladder
-- (the doubled 1000 ft milestone, and the handful logged out of order); group the survivors into bursts (<= 5 s).
CREATE TEMP TABLE dc_ms AS
SELECT milestone_id, user_id, ladder_region_id, mission_label, mission_distance, ts, street_region_id, audit_task_id, source, unplaced,
       legacy_mission_user_id, paid, pay_per_mile,
       COALESCE((SELECT l.rung_m FROM dc_ladder l WHERE l.legacy_mission_id = dc_migration_milestone.legacy_mission_id), 0) AS rung_m,
       mission_distance - COALESCE(MAX(mission_distance) OVER (PARTITION BY user_id, ladder_region_id ORDER BY ts, milestone_id
                                                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS chunk_m
FROM dc_migration_milestone;
DELETE FROM dc_ms WHERE chunk_m <= 0;

CREATE TEMP TABLE dc_group AS
SELECT *, SUM(new_group) OVER (PARTITION BY user_id ORDER BY ts, milestone_id) AS grp
FROM (SELECT *, CASE WHEN ts - LAG(ts) OVER (PARTITION BY user_id ORDER BY ts, milestone_id) <= interval '5 seconds' THEN 0 ELSE 1 END AS new_group
      FROM dc_ms) g;

-- 3e. One completed audit mission per burst. It starts where the user's previous mission in the same region ended
-- (or at their first task there), ends at the milestone, spans the chunk (the distance actually newly covered),
-- and carries exactly what the app paid for its mission_user rows: each rung's own ladder chunk x pay_per_mile,
-- paid only if every recorded row was paid. Windows are per (user, region), so a
-- user's work in region B between two region-A milestones lands in B's own mission.
CREATE TEMP TABLE dc_new_mission AS
SELECT user_id, grp,
       MAX(ts) AS mission_end,
       SUM(chunk_m) AS chunk_m,
       (ARRAY_AGG(street_region_id ORDER BY ts DESC, milestone_id DESC))[1] AS region_id,
       (ARRAY_AGG(ladder_region_id ORDER BY ts DESC, milestone_id DESC))[1] AS ladder_region_id,
       COALESCE(SUM(rung_m / 1609.344 * pay_per_mile) FILTER (WHERE legacy_mission_user_id IS NOT NULL), 0) AS pay,
       COALESCE(BOOL_AND(paid) FILTER (WHERE legacy_mission_user_id IS NOT NULL), FALSE) AS paid,
       BOOL_OR(unplaced) AS unplaced,
       COUNT(*) AS burst_size,
       STRING_AGG(DISTINCT source, '+') AS source
FROM dc_group
GROUP BY user_id, grp;

ALTER TABLE dc_new_mission ADD COLUMN mission_id INT;
INSERT INTO mission (mission_type_id, user_id, mission_start, mission_end, completed, pay, paid, distance_meters, distance_progress, region_id, skipped)
SELECT 2, n.user_id,
       COALESCE(LAG(n.mission_end) OVER (PARTITION BY n.user_id, n.region_id ORDER BY n.mission_end, n.grp),
                (SELECT MIN(t0) FROM dc_task WHERE dc_task.user_id = n.user_id AND dc_task.region_id IS NOT DISTINCT FROM n.region_id
                                               AND dc_task.t0 <= n.mission_end),
                n.mission_end - interval '1 minute'),
       n.mission_end, TRUE, n.pay, n.paid, n.chunk_m, n.chunk_m, n.region_id, FALSE
FROM dc_new_mission n
ORDER BY n.user_id, n.mission_end, n.grp;

-- Link bursts and milestones to the mission rows they produced (before anything moves a mission_end).
UPDATE dc_new_mission n SET mission_id = mission.mission_id
FROM mission WHERE mission.user_id = n.user_id AND mission.mission_end = n.mission_end AND mission.mission_type_id = 2;
UPDATE dc_migration_milestone m
SET mission_id = n.mission_id
FROM dc_group g JOIN dc_new_mission n ON n.user_id = g.user_id AND n.grp = g.grp
WHERE m.milestone_id = g.milestone_id;

-- A dropped duplicate can still carry a paid mission_user row (the app paid the rung it thought it was). That pay
-- belongs to the nearest kept mission on the same ladder, so payment history stays whole.
UPDATE mission SET pay = mission.pay + extra.pay
FROM (
  SELECT k.mission_id, SUM(d.rung_m / 1609.344 * d.pay_per_mile) AS pay
  FROM (SELECT m.*, COALESCE((SELECT l.rung_m FROM dc_ladder l WHERE l.legacy_mission_id = m.legacy_mission_id), 0) AS rung_m
        FROM dc_migration_milestone m WHERE m.mission_id IS NULL AND m.legacy_mission_user_id IS NOT NULL) d
  JOIN LATERAL (SELECT mission_id FROM dc_migration_milestone k
                WHERE k.user_id = d.user_id AND k.ladder_region_id = d.ladder_region_id AND k.mission_id IS NOT NULL
                ORDER BY CASE WHEN k.ts <= d.ts THEN 0 ELSE 1 END, ABS(EXTRACT(EPOCH FROM (k.ts - d.ts))) LIMIT 1) k ON TRUE
  WHERE d.rung_m > 0 AND d.pay_per_mile > 0
  GROUP BY k.mission_id
) extra
WHERE mission.mission_id = extra.mission_id;

-- 3f. Tails: work after a user's last milestone in a region (or all of it, where they never reached one) becomes
-- one completed mission per (user, region) with its real progress and the next ladder chunk as its target. A tail
-- shorter than the smallest modern mission (250 ft) that follows a mission in the same region is folded into that
-- mission instead, so a few extra metres after a milestone don't read as a mission of their own.
INSERT INTO mission (mission_type_id, user_id, mission_start, mission_end, completed, pay, paid, distance_meters, distance_progress, region_id, skipped)
SELECT 2, tail.user_id,
       COALESCE(tail.last_end, tail.first_t0),
       GREATEST(tail.last_t1, COALESCE(tail.last_end, tail.first_t0) + interval '1 second'),
       TRUE, 0, FALSE,
       COALESCE(next_rung.chunk, tail.progress_m), tail.progress_m, tail.region_id, FALSE
FROM (
  SELECT dc_task.user_id, dc_task.region_id, lm.mission_end AS last_end,
         MIN(dc_task.t0) AS first_t0, MAX(dc_task.t1) AS last_t1, SUM(dc_task.len_m) AS progress_m
  FROM dc_task
  LEFT JOIN (SELECT user_id, region_id, MAX(mission_end) AS mission_end FROM mission WHERE mission_type_id = 2 GROUP BY user_id, region_id) lm
         ON lm.user_id = dc_task.user_id AND lm.region_id IS NOT DISTINCT FROM dc_task.region_id
  WHERE lm.mission_end IS NULL OR dc_task.t1 > lm.mission_end
  GROUP BY dc_task.user_id, dc_task.region_id, lm.mission_end
) tail
LEFT JOIN LATERAL (
  SELECT l.distance - COALESCE(MAX(m.mission_distance), 0) AS chunk
  FROM dc_ladder l
  LEFT JOIN dc_migration_milestone m ON m.user_id = tail.user_id AND m.ladder_region_id = tail.region_id AND m.mission_id IS NOT NULL
  WHERE l.region_id = tail.region_id AND l.label = 'distance-mission'
  GROUP BY l.distance
  HAVING l.distance - COALESCE(MAX(m.mission_distance), 0) > 0
  ORDER BY l.distance LIMIT 1) next_rung ON TRUE
WHERE tail.progress_m >= 76.2 OR tail.last_end IS NULL;

UPDATE mission
SET mission_end = tail.last_t1, distance_progress = COALESCE(mission.distance_progress, 0) + tail.progress_m
FROM (
  SELECT dc_task.user_id, dc_task.region_id, lm.mission_id, MAX(dc_task.t1) AS last_t1, SUM(dc_task.len_m) AS progress_m
  FROM dc_task
  JOIN (SELECT DISTINCT ON (user_id, region_id) user_id, region_id, mission_id, mission_end FROM mission WHERE mission_type_id = 2
        ORDER BY user_id, region_id, mission_end DESC) lm
    ON lm.user_id = dc_task.user_id AND lm.region_id IS NOT DISTINCT FROM dc_task.region_id
  WHERE dc_task.t1 > lm.mission_end
  GROUP BY dc_task.user_id, dc_task.region_id, lm.mission_id
  HAVING SUM(dc_task.len_m) < 76.2
) tail
WHERE mission.mission_id = tail.mission_id;

-- 3g. Onboarding: one completed auditOnboarding mission per user with an Onboarding_End event, a legacy
-- onboarding row, or tutorial labels (which modern cities only ever attach to an onboarding mission), timed by the
-- events where they exist and otherwise placed just before the user's first task.
INSERT INTO mission (mission_type_id, user_id, mission_start, mission_end, completed, pay, paid, skipped)
SELECT 1, u.user_id,
       COALESCE(ob.start_ts, first_task.t0 - interval '10 minutes', now()),
       COALESCE(ob.end_ts, first_task.t0 - interval '1 second', now()),
       TRUE, 0, FALSE, FALSE
FROM (
  SELECT DISTINCT dc_task.user_id FROM dc_migration_event e JOIN dc_task ON dc_task.audit_task_id = e.audit_task_id WHERE e.action = 'Onboarding_End'
  UNION
  SELECT mu.user_id FROM dc_migration_legacy_mission_user mu JOIN dc_migration_legacy_mission m ON m.mission_id = mu.mission_id WHERE m.label = 'onboarding'
  UNION
  SELECT DISTINCT dc_task.user_id FROM label JOIN dc_task ON dc_task.audit_task_id = label.audit_task_id
  WHERE label.gsv_panorama_id IN (SELECT gsv_panorama_id FROM gsv_onboarding_pano WHERE has_labels = TRUE)
) u
JOIN "user" ON "user".user_id = u.user_id
LEFT JOIN LATERAL (
  SELECT MIN(e.timestamp) FILTER (WHERE e.action = 'Onboarding_Start') AS start_ts,
         MIN(e.timestamp) FILTER (WHERE e.action = 'Onboarding_End') AS end_ts
  FROM dc_migration_event e JOIN dc_task ON dc_task.audit_task_id = e.audit_task_id
  WHERE dc_task.user_id = u.user_id AND e.action IN ('Onboarding_Start', 'Onboarding_End')) ob ON TRUE
LEFT JOIN LATERAL (SELECT MIN(t0) AS t0 FROM dc_task WHERE dc_task.user_id = u.user_id) first_task ON TRUE;
UPDATE mission SET mission_start = mission_end - interval '10 minutes' WHERE mission_type_id = 1 AND mission_start >= mission_end;

-- ---------------------------------------------------------------------------------------------------------------
-- Part 4. Placement: the mission a user's activity at time t belongs to is the audit mission whose window holds t;
-- outside every window, the nearest one in time.
CREATE TEMP TABLE dc_window AS
SELECT mission_id, user_id, region_id, mission_start, mission_end FROM mission WHERE mission_type_id = 2;
CREATE INDEX ON dc_window (user_id, mission_start, mission_end);

-- The mission a user's activity at time t on a street of region r belongs to: the window of that region holding
-- t, else any window holding t, else the nearest window of that region, else the nearest of any.
CREATE OR REPLACE FUNCTION pg_temp.dc_mission_at(p_user TEXT, p_ts TIMESTAMPTZ, p_region INT) RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT mission_id FROM dc_window
  WHERE user_id = p_user
  ORDER BY CASE WHEN p_ts > mission_start AND p_ts <= mission_end THEN 0 ELSE 1 END,
           CASE WHEN region_id IS NOT DISTINCT FROM p_region THEN 0 ELSE 1 END,
           LEAST(ABS(EXTRACT(EPOCH FROM (p_ts - mission_end))), ABS(EXTRACT(EPOCH FROM (p_ts - mission_start)))),
           mission_id
  LIMIT 1
$$;

-- The mission each task ended in (168 later stores it as audit_task.current_mission_id via patches/169.pre.sql);
-- environment and incomplete rows have no timestamp of their own and follow it.
CREATE TABLE dc_migration_task_mission AS
SELECT audit_task_id, user_id, region_id, pg_temp.dc_mission_at(user_id, t1, region_id) AS mission_id, t0, t1 FROM dc_task;
CREATE INDEX ON dc_migration_task_mission (audit_task_id);

-- Labels: by the first interaction that mentions the label (what 163.sql later uses), else time_created read in
-- the zone patches/26.sql will convert it with (it is still naive here), else the task start; tutorial labels go
-- to the user's onboarding mission.
CREATE TEMP TABLE dc_onboarding_pano AS SELECT gsv_panorama_id FROM gsv_onboarding_pano WHERE has_labels = TRUE;
CREATE TEMP TABLE dc_label_place AS
SELECT label.label_id, tm.user_id, tm.region_id,
       COALESCE(lt.first_ts,
                CASE WHEN label.time_created < '2018-08-25' THEN label.time_created AT TIME ZONE 'US/Eastern'
                     ELSE label.time_created AT TIME ZONE 'UTC' END,
                tm.t0) AS ts,
       label.gsv_panorama_id IN (SELECT gsv_panorama_id FROM dc_onboarding_pano) AS is_tutorial
FROM label
JOIN dc_migration_task_mission tm ON tm.audit_task_id = label.audit_task_id
LEFT JOIN dc_migration_label_time lt ON lt.audit_task_id = label.audit_task_id AND lt.temporary_label_id = label.temporary_label_id;
CREATE TEMP TABLE dc_onboarding_mission AS SELECT user_id, MIN(mission_id) AS mission_id FROM mission WHERE mission_type_id = 1 GROUP BY user_id;
ALTER TABLE label ADD COLUMN mission_id INT;
UPDATE label
SET mission_id = COALESCE(CASE WHEN p.is_tutorial THEN om.mission_id END, pg_temp.dc_mission_at(p.user_id, p.ts, p.region_id))
FROM dc_label_place p
LEFT JOIN dc_onboarding_mission om ON om.user_id = p.user_id
WHERE p.label_id = label.label_id;

-- Interactions: by timestamp, but only the tasks that straddle a mission boundary need the per-row lookup; the
-- rest take their task's mission in one pass (this is the long pole on the 135 M-row full run).
ALTER TABLE audit_task_interaction ADD COLUMN mission_id INT;
CREATE TEMP TABLE dc_task_single AS
SELECT tm.audit_task_id, tm.mission_id
FROM dc_migration_task_mission tm
JOIN dc_window w ON w.mission_id = tm.mission_id
WHERE tm.t0 >= w.mission_start;
CREATE INDEX ON dc_task_single (audit_task_id);
UPDATE audit_task_interaction SET mission_id = s.mission_id FROM dc_task_single s WHERE s.audit_task_id = audit_task_interaction.audit_task_id;
UPDATE audit_task_interaction SET mission_id = pg_temp.dc_mission_at(tm.user_id, audit_task_interaction.timestamp, tm.region_id)
FROM dc_migration_task_mission tm
WHERE tm.audit_task_id = audit_task_interaction.audit_task_id AND audit_task_interaction.mission_id IS NULL;

ALTER TABLE audit_task_environment ADD COLUMN mission_id INT;
UPDATE audit_task_environment SET mission_id = tm.mission_id FROM dc_migration_task_mission tm WHERE tm.audit_task_id = audit_task_environment.audit_task_id;

ALTER TABLE audit_task_incomplete ADD COLUMN mission_id INT;
UPDATE audit_task_incomplete SET mission_id = tm.mission_id FROM dc_migration_task_mission tm WHERE tm.audit_task_id = audit_task_incomplete.audit_task_id;

-- Comments carry (user_id, edge_id, timestamp) but no task id: the user's task on that street whose window holds
-- the comment, else the nearest-in-time one on that street, else their nearest-in-time task anywhere.
ALTER TABLE audit_task_comment ADD COLUMN audit_task_id INT, ADD COLUMN mission_id INT;
UPDATE audit_task_comment
SET audit_task_id = (
  SELECT audit_task.audit_task_id FROM audit_task
  WHERE audit_task.user_id = audit_task_comment.user_id AND audit_task.street_edge_id = audit_task_comment.edge_id
  ORDER BY CASE WHEN audit_task_comment.timestamp BETWEEN audit_task.task_start AND COALESCE(audit_task.task_end, audit_task_comment.timestamp) THEN 0 ELSE 1 END,
           ABS(EXTRACT(EPOCH FROM (audit_task.task_start - audit_task_comment.timestamp)))
  LIMIT 1);
UPDATE audit_task_comment
SET audit_task_id = (
  SELECT audit_task.audit_task_id FROM audit_task WHERE audit_task.user_id = audit_task_comment.user_id
  ORDER BY ABS(EXTRACT(EPOCH FROM (audit_task.task_start - audit_task_comment.timestamp))) LIMIT 1)
WHERE audit_task_id IS NULL;
UPDATE audit_task_comment
SET mission_id = pg_temp.dc_mission_at(user_id, timestamp, (SELECT region_id FROM street_edge_region WHERE street_edge_region.street_edge_id = audit_task_comment.edge_id));

-- ---------------------------------------------------------------------------------------------------------------
-- Part 5. Mainline 16's constraints.
ALTER TABLE audit_task_comment
  ALTER COLUMN audit_task_id SET NOT NULL,
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id),
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);
ALTER TABLE audit_task_interaction
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);
ALTER TABLE audit_task_environment
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);
ALTER TABLE audit_task_incomplete
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);
ALTER TABLE label
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Part 6. Audit trail and report.
CREATE TABLE dc_migration_mission AS
SELECT mission.mission_id, mission.user_id, mission.region_id, mission.mission_start, mission.mission_end,
       mission.distance_meters, mission.pay, mission.paid,
       CASE WHEN mission.mission_type_id = 1 THEN 'onboarding' ELSE COALESCE(n.source, 'tail') END AS source,
       n.ladder_region_id, n.burst_size, COALESCE(n.unplaced, FALSE) AS unplaced
FROM mission
LEFT JOIN dc_new_mission n ON n.mission_id = mission.mission_id;

SELECT 'missions by source' AS what, source, count(*) AS n FROM dc_migration_mission GROUP BY source
UNION ALL SELECT 'milestones by source', source, count(*) FROM dc_migration_milestone GROUP BY source
UNION ALL SELECT 'milestones dropped as duplicates', source, count(*) FROM dc_migration_milestone WHERE mission_id IS NULL GROUP BY source
UNION ALL SELECT 'unplaced (threshold never reached)', '', (SELECT count(*) FROM dc_migration_milestone WHERE unplaced)
UNION ALL SELECT 'legacy paid total ($, rung-based like the app)', '',
  (SELECT ROUND(SUM(l.rung_m / 1609.344 * mu.pay_per_mile)) FROM dc_migration_legacy_mission_user mu JOIN dc_ladder l ON l.legacy_mission_id = mu.mission_id WHERE mu.paid)
UNION ALL SELECT 'reconstructed paid total ($)', '', (SELECT ROUND(SUM(pay)) FROM mission WHERE paid)
UNION ALL SELECT 'labels on onboarding missions', '', (SELECT count(*) FROM label JOIN mission USING (mission_id) WHERE mission_type_id = 1)
UNION ALL SELECT 'tasks whose mission region <> street region', '', (SELECT count(*) FROM dc_migration_task_mission tm JOIN mission USING (mission_id) WHERE mission.region_id IS DISTINCT FROM tm.region_id)
UNION ALL SELECT 'labels whose mission region <> street region', '', (SELECT count(*) FROM label JOIN mission USING (mission_id) JOIN street_edge_region ON street_edge_region.street_edge_id = (SELECT street_edge_id FROM audit_task WHERE audit_task.audit_task_id = label.audit_task_id) WHERE mission.region_id IS DISTINCT FROM street_edge_region.region_id AND mission.mission_type_id = 2)
ORDER BY 1, 2;
