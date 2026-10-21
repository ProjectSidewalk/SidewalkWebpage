-- Split the legacy shared "anonymous" account into one anonymous user per IP address (issue #4700).
--
-- DC's server recorded every signed-out visitor under one user (97760883-…, username "anonymous"): 12,850 audit
-- tasks and 32,180 labels over 4,205 IPs. Modern cities give each anonymous session its own user (role Anonymous),
-- so the legacy audit work is split here, before 16 synthesizes missions per user. Runs after mainline 15, which
-- inserts role 6 'Anonymous'.
--
-- Rules (Mikey, 2026-09-02):
--   * one synthetic user per distinct IP that has an anonymous audit task; a task's IP is that of its first
--     audit_task_environment row (the task-start environment; 1,736 tasks were resumed from another IP later);
--   * audit_task_comment rows carry their own IP and follow it; the one comment whose IP never audited goes to the
--     synthetic user whose task on that street is nearest in time (16 then maps it to that task);
--   * webpage_activity rows re-point by IP only where an auditing user exists for that IP; visit-only IPs stay on
--     the legacy account, which is what develop's LoggingService does today for identity-less visits;
--   * the legacy account itself survives (it is prod's default anon account, same user_id).
-- Usernames/emails take the modern generated shape (16 lowercase alphanumerics, anonymous@<username>.com), derived
-- deterministically from the IP so re-runs are stable; user_ids are fresh UUIDs.
SET search_path TO sidewalk, public;

-- Working indexes (audit_task_environment and webpage_activity have none on these columns; 100 and 270 add the
-- real ones later). Dropped by the post-clean.
CREATE INDEX dc_tmp_ate_task_idx ON audit_task_environment (audit_task_id, audit_task_environment_id);
CREATE INDEX dc_tmp_wa_ip_idx ON webpage_activity (ip_address) WHERE user_id = '97760883-8ef0-4309-9a5e-0c086ef27573';

-- Each anonymous task's IP: its first environment row.
CREATE TEMP TABLE dc_anon_task_ip AS
SELECT DISTINCT ON (audit_task_environment.audit_task_id)
       audit_task_environment.audit_task_id, audit_task_environment.ip_address
FROM audit_task_environment
JOIN audit_task ON audit_task.audit_task_id = audit_task_environment.audit_task_id
WHERE audit_task.user_id = '97760883-8ef0-4309-9a5e-0c086ef27573' AND audit_task_environment.ip_address IS NOT NULL
ORDER BY audit_task_environment.audit_task_id, audit_task_environment.audit_task_environment_id;

CREATE TABLE dc_migration_anon_user (
  ip_address TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE
);
INSERT INTO dc_migration_anon_user (ip_address, user_id, username)
SELECT ip_address, gen_random_uuid()::text, substr(md5('dc-anon:' || ip_address), 1, 16)
FROM (SELECT DISTINCT ip_address FROM dc_anon_task_ip) ip;

INSERT INTO "user" (user_id, username, email)
SELECT user_id, username, 'anonymous@' || username || '.com' FROM dc_migration_anon_user;
INSERT INTO user_role (user_id, role_id)
SELECT user_id, (SELECT role_id FROM role WHERE role = 'Anonymous') FROM dc_migration_anon_user;

-- Tasks follow their task-start IP.
UPDATE audit_task
SET user_id = dc_migration_anon_user.user_id
FROM dc_anon_task_ip
JOIN dc_migration_anon_user ON dc_migration_anon_user.ip_address = dc_anon_task_ip.ip_address
WHERE audit_task.audit_task_id = dc_anon_task_ip.audit_task_id;

UPDATE audit_task_comment
SET user_id = dc_migration_anon_user.user_id
FROM dc_migration_anon_user
WHERE audit_task_comment.user_id = '97760883-8ef0-4309-9a5e-0c086ef27573'
  AND audit_task_comment.ip_address = dc_migration_anon_user.ip_address;

UPDATE audit_task_comment
SET user_id = (
  SELECT audit_task.user_id FROM audit_task
  JOIN dc_migration_anon_user ON dc_migration_anon_user.user_id = audit_task.user_id
  WHERE audit_task.street_edge_id = audit_task_comment.edge_id
  ORDER BY ABS(EXTRACT(EPOCH FROM (audit_task.task_start - audit_task_comment.timestamp)))
  LIMIT 1)
WHERE audit_task_comment.user_id = '97760883-8ef0-4309-9a5e-0c086ef27573'
  AND EXISTS (SELECT 1 FROM audit_task JOIN dc_migration_anon_user ON dc_migration_anon_user.user_id = audit_task.user_id
              WHERE audit_task.street_edge_id = audit_task_comment.edge_id);

UPDATE webpage_activity
SET user_id = dc_migration_anon_user.user_id
FROM dc_migration_anon_user
WHERE webpage_activity.user_id = '97760883-8ef0-4309-9a5e-0c086ef27573'
  AND webpage_activity.ip_address = dc_migration_anon_user.ip_address;

-- Report.
SELECT 'anon users created' AS what, count(*) FROM dc_migration_anon_user
UNION ALL SELECT 'tasks still on legacy anon', count(*) FROM audit_task WHERE user_id = '97760883-8ef0-4309-9a5e-0c086ef27573'
UNION ALL SELECT 'webpage_activity re-pointed', count(*) FROM webpage_activity WHERE user_id IN (SELECT user_id FROM dc_migration_anon_user)
UNION ALL SELECT 'webpage_activity still on legacy anon', count(*) FROM webpage_activity WHERE user_id = '97760883-8ef0-4309-9a5e-0c086ef27573';

-- ---------------------------------------------------------------------------------------------------------------
-- Interaction-log evidence for the mission reconstruction in patches/16.sql, from the extracts that
-- harness/extract-events.sh writes into the db container from the full baseline. Loaded from the files even on the
-- full run, so both runs reconstruct from byte-identical inputs. Dropped by the post-clean.
CREATE TABLE dc_migration_event (
  audit_task_interaction_id BIGINT PRIMARY KEY,
  audit_task_id INT NOT NULL,
  action TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  note TEXT
);
\copy dc_migration_event FROM '/tmp/dc-events/events.csv' CSV HEADER
DELETE FROM dc_migration_event WHERE NOT EXISTS (SELECT 1 FROM audit_task WHERE audit_task.audit_task_id = dc_migration_event.audit_task_id);
CREATE INDEX ON dc_migration_event (audit_task_id, action);
CREATE TABLE dc_migration_label_time (
  audit_task_id INT NOT NULL,
  temporary_label_id INT NOT NULL,
  first_ts TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (audit_task_id, temporary_label_id)
);
\copy dc_migration_label_time FROM '/tmp/dc-events/label_times.csv' CSV HEADER
ANALYZE dc_migration_event; ANALYZE dc_migration_label_time;
SELECT 'events loaded' AS what, action, count(*) FROM dc_migration_event GROUP BY action ORDER BY 2;
