-- Patched mainline 16.sql for the DC migration (issue #4700). The original TRUNCATEs label,
-- label_tag, user_attribute_label, and the audit_task_* side tables so it can add
-- mission_id INT NOT NULL columns to empty tables. Here we keep all data: create the new mission
-- model, synthesize one completed legacy 'audit' mission per (user, region) from audit history,
-- backfill mission_id everywhere, then apply the NOT NULLs and FKs.
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

-- Same shape as mainline 16, except mission_start/mission_end are TIMESTAMPTZ from the start:
-- the synthesized values below come from audit_task's TIMESTAMPTZ columns, and running them
-- through 26.sql's naive-timestamp + US/Eastern conversion would corrupt them, so patches/26.sql
-- skips the mission block.
CREATE TABLE mission
(
  mission_id SERIAL NOT NULL,
  mission_type_id INT NOT NULL,
  user_id TEXT NOT NULL,
  mission_start TIMESTAMPTZ NOT NULL,
  mission_end TIMESTAMPTZ NOT NULL,
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

-- Each audit_task's region: streets on a region boundary can map to several regions; MIN keeps the
-- pairing deterministic and identical between mission synthesis and the backfills below.
CREATE TEMP TABLE dc_task_region AS
SELECT audit_task.audit_task_id, audit_task.user_id, audit_task.task_start, audit_task.task_end,
       (SELECT MIN(region_id) FROM street_edge_region
        WHERE street_edge_region.street_edge_id = audit_task.street_edge_id) AS region_id
FROM audit_task;

INSERT INTO mission (mission_type_id, user_id, mission_start, mission_end, completed, pay, paid, region_id, skipped)
SELECT 2, user_id, MIN(task_start), MAX(task_end), TRUE, 0.0, FALSE, region_id, FALSE
FROM dc_task_region
GROUP BY user_id, region_id;

CREATE TEMP TABLE dc_task_mission AS
SELECT dc_task_region.audit_task_id, mission.mission_id
FROM dc_task_region
JOIN mission ON mission.user_id = dc_task_region.user_id
  AND mission.region_id IS NOT DISTINCT FROM dc_task_region.region_id
  AND mission.mission_type_id = 2;
CREATE INDEX ON dc_task_mission (audit_task_id);

-- The 2015-era tables had no FKs; a handful of side-table rows reference audit_tasks that no
-- longer exist (2 in audit_task_incomplete on the core dump). Drop them -- the eventual FK adds
-- (here and in 337.sql) require it, and they describe tasks that are already gone.
DELETE FROM audit_task_incomplete WHERE NOT EXISTS
  (SELECT 1 FROM audit_task WHERE audit_task.audit_task_id = audit_task_incomplete.audit_task_id);
DELETE FROM audit_task_environment WHERE NOT EXISTS
  (SELECT 1 FROM audit_task WHERE audit_task.audit_task_id = audit_task_environment.audit_task_id);
DELETE FROM audit_task_interaction WHERE NOT EXISTS
  (SELECT 1 FROM audit_task WHERE audit_task.audit_task_id = audit_task_interaction.audit_task_id);

ALTER TABLE audit_task_comment
  ADD COLUMN audit_task_id INT,
  ADD COLUMN mission_id INT;

-- Old comments carry (user_id, edge_id, timestamp) but no task id; pick the user's task on that
-- street whose time window contains the comment, else the nearest-in-time one.
UPDATE audit_task_comment
SET audit_task_id = (
  SELECT audit_task.audit_task_id FROM audit_task
  WHERE audit_task.user_id = audit_task_comment.user_id
    AND audit_task.street_edge_id = audit_task_comment.edge_id
  ORDER BY CASE WHEN audit_task_comment.timestamp
                     BETWEEN audit_task.task_start AND COALESCE(audit_task.task_end, audit_task_comment.timestamp)
                THEN 0 ELSE 1 END,
           ABS(EXTRACT(EPOCH FROM (audit_task.task_start - audit_task_comment.timestamp)))
  LIMIT 1);

-- Comments on streets the user never had a task for fall back to their nearest-in-time task.
UPDATE audit_task_comment
SET audit_task_id = (
  SELECT audit_task.audit_task_id FROM audit_task
  WHERE audit_task.user_id = audit_task_comment.user_id
  ORDER BY ABS(EXTRACT(EPOCH FROM (audit_task.task_start - audit_task_comment.timestamp)))
  LIMIT 1)
WHERE audit_task_id IS NULL;

UPDATE audit_task_comment SET mission_id = dc_task_mission.mission_id
FROM dc_task_mission WHERE dc_task_mission.audit_task_id = audit_task_comment.audit_task_id;

ALTER TABLE audit_task_comment
  ALTER COLUMN audit_task_id SET NOT NULL,
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id),
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_interaction ADD COLUMN mission_id INT;
UPDATE audit_task_interaction SET mission_id = dc_task_mission.mission_id
FROM dc_task_mission WHERE dc_task_mission.audit_task_id = audit_task_interaction.audit_task_id;
ALTER TABLE audit_task_interaction
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_environment ADD COLUMN mission_id INT;
UPDATE audit_task_environment SET mission_id = dc_task_mission.mission_id
FROM dc_task_mission WHERE dc_task_mission.audit_task_id = audit_task_environment.audit_task_id;
ALTER TABLE audit_task_environment
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_incomplete ADD COLUMN mission_id INT;
UPDATE audit_task_incomplete SET mission_id = dc_task_mission.mission_id
FROM dc_task_mission WHERE dc_task_mission.audit_task_id = audit_task_incomplete.audit_task_id;
ALTER TABLE audit_task_incomplete
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE label ADD COLUMN mission_id INT;
UPDATE label SET mission_id = dc_task_mission.mission_id
FROM dc_task_mission WHERE dc_task_mission.audit_task_id = label.audit_task_id;
ALTER TABLE label
  ALTER COLUMN mission_id SET NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);
