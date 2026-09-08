-- Merge DC's users into the shared sidewalk_login schema (issue #4700). Runs inside the database that holds
-- sidewalk_login, sidewalk_dc (the migrated city schema) and sidewalk_dc_login (DC's own login rows, as packaged by
-- harness/package.sh), in one transaction. Same shape as the Oct-2024 unified-login merge
-- (scratchpad/unified-login-migration/): merge by email, remap user_ids in the city schema, suffix colliding
-- usernames with the city name.
--
-- Rules (Mikey, 2026-09-02):
--   * same user_id on both sides = same account (the shared default anonymous user);
--   * hand decisions first: aileen, EronKutov, Gari, Joanne, manaswi, nicole.thewissen are the prod accounts of
--     the same username despite different emails; DC's "Jon Froehlich" is prod's jonfroehlich (not the
--     jonfroehlich_mapathon2 account its email would match); jonf_test1 has no data and is dropped;
--   * then a case-insensitive email match to exactly one prod account merges onto it;
--   * DC accounts sharing an email merge into one: the one already mapped, else the highest role, else the most
--     audit tasks;
--   * everyone else is inserted; a username prod already has gets the `_dc` suffix (Erin -> Erin_dc);
--   * a merged account keeps prod's credentials and prod's role; DC-only accounts bring their own.
-- The map is kept in sidewalk_dc.dc_migration_user_map for the record.
SET search_path TO sidewalk_dc, sidewalk_login, public;

-- sidewalk_login.sidewalk_user is indexed on email but not lower(email); without this the email match is a
-- per-row scan of ~6 M rows. Dropped at the end so the shared schema is left as found.
CREATE INDEX dc_tmp_lower_email_idx ON sidewalk_login.sidewalk_user (lower(email));
ANALYZE sidewalk_login.sidewalk_user;

CREATE TABLE sidewalk_dc.dc_migration_user_map (
  dc_user_id TEXT PRIMARY KEY,
  prod_user_id TEXT NOT NULL,
  how TEXT NOT NULL,
  dc_username TEXT,
  prod_username TEXT
);

INSERT INTO dc_migration_user_map (dc_user_id, prod_user_id, how, dc_username, prod_username)
SELECT d.user_id, p.user_id, 'same user_id', d.username, p.username
FROM sidewalk_dc_login.sidewalk_user d JOIN sidewalk_login.sidewalk_user p ON p.user_id = d.user_id;

INSERT INTO dc_migration_user_map (dc_user_id, prod_user_id, how, dc_username, prod_username)
SELECT d.user_id, p.user_id, 'hand: same person', d.username, p.username
FROM (VALUES ('aileen', 'aileen'), ('EronKutov', 'EronKutov'), ('Gari', 'Gari'), ('Joanne', 'Joanne'), ('manaswi', 'manaswi'),
             ('nicole.thewissen', 'nicole.thewissen'), ('Jon Froehlich', 'jonfroehlich')) AS h (dc_username, prod_username)
JOIN sidewalk_dc_login.sidewalk_user d ON d.username = h.dc_username
JOIN sidewalk_login.sidewalk_user p ON p.username = h.prod_username
ON CONFLICT (dc_user_id) DO NOTHING;
DELETE FROM sidewalk_dc_login.user_role WHERE user_id IN (SELECT user_id FROM sidewalk_dc_login.sidewalk_user WHERE username = 'jonf_test1');
DELETE FROM sidewalk_dc_login.user_password_info WHERE login_info_id IN (SELECT login_info_id FROM sidewalk_dc_login.user_login_info WHERE user_id IN (SELECT user_id FROM sidewalk_dc_login.sidewalk_user WHERE username = 'jonf_test1'));
DELETE FROM sidewalk_dc_login.user_login_info WHERE user_id IN (SELECT user_id FROM sidewalk_dc_login.sidewalk_user WHERE username = 'jonf_test1');
DELETE FROM sidewalk_dc.user_stat WHERE user_id IN (SELECT user_id FROM sidewalk_dc_login.sidewalk_user WHERE username = 'jonf_test1');
DELETE FROM sidewalk_dc.webpage_activity WHERE user_id IN (SELECT user_id FROM sidewalk_dc_login.sidewalk_user WHERE username = 'jonf_test1');
DELETE FROM sidewalk_dc_login.sidewalk_user WHERE username = 'jonf_test1';

-- One grouped pass rather than a per-DC-row count subquery: with no statistics on the fresh expression index the
-- planner scanned all ~6 M prod rows once per DC account (hours).
INSERT INTO dc_migration_user_map (dc_user_id, prod_user_id, how, dc_username, prod_username)
SELECT d.user_id, p.user_id, 'email', d.username, p.username
FROM sidewalk_dc_login.sidewalk_user d
JOIN (SELECT lower(email) AS email_lc, min(user_id) AS user_id, min(username) AS username, count(*) AS n
      FROM sidewalk_login.sidewalk_user
      WHERE lower(email) IN (SELECT lower(email) FROM sidewalk_dc_login.sidewalk_user)
      GROUP BY lower(email)) p ON p.email_lc = lower(d.email)
WHERE p.n = 1 AND d.user_id NOT IN (SELECT dc_user_id FROM dc_migration_user_map);

INSERT INTO dc_migration_user_map (dc_user_id, prod_user_id, how, dc_username, prod_username)
SELECT dup.user_id, COALESCE(m.prod_user_id, primary_user.user_id), 'dc duplicate email -> ' || primary_user.username, dup.username, COALESCE(m.prod_username, primary_user.username)
FROM sidewalk_dc_login.sidewalk_user dup
JOIN LATERAL (
  SELECT u.user_id, u.username
  FROM sidewalk_dc_login.sidewalk_user u
  LEFT JOIN sidewalk_dc_login.user_role r ON r.user_id = u.user_id
  WHERE lower(u.email) = lower(dup.email) AND u.user_id <> dup.user_id
  ORDER BY (u.user_id IN (SELECT dc_user_id FROM dc_migration_user_map)) DESC,
           CASE r.role::text WHEN 'Owner' THEN 5 WHEN 'Administrator' THEN 4 WHEN 'Researcher' THEN 3 WHEN 'Turker' THEN 2 WHEN 'Registered' THEN 1 ELSE 0 END DESC,
           (SELECT count(*) FROM sidewalk_dc.audit_task a WHERE a.user_id = u.user_id) DESC,
           u.user_id
  LIMIT 1) primary_user ON TRUE
LEFT JOIN dc_migration_user_map m ON m.dc_user_id = primary_user.user_id
WHERE dup.user_id NOT IN (SELECT dc_user_id FROM dc_migration_user_map)
  AND (SELECT count(*) FROM sidewalk_dc_login.sidewalk_user u2 WHERE lower(u2.email) = lower(dup.email)) > 1
  -- the primary is the best account of the group; everyone else in the group maps onto it
  AND primary_user.user_id = (
    SELECT u.user_id FROM sidewalk_dc_login.sidewalk_user u LEFT JOIN sidewalk_dc_login.user_role r ON r.user_id = u.user_id
    WHERE lower(u.email) = lower(dup.email)
    ORDER BY (u.user_id IN (SELECT dc_user_id FROM dc_migration_user_map)) DESC,
             CASE r.role::text WHEN 'Owner' THEN 5 WHEN 'Administrator' THEN 4 WHEN 'Researcher' THEN 3 WHEN 'Turker' THEN 2 WHEN 'Registered' THEN 1 ELSE 0 END DESC,
             (SELECT count(*) FROM sidewalk_dc.audit_task a WHERE a.user_id = u.user_id) DESC,
             u.user_id
    LIMIT 1);

CREATE TEMP TABLE dc_new_user AS
SELECT d.user_id, d.email,
       CASE WHEN EXISTS (SELECT 1 FROM sidewalk_login.sidewalk_user p WHERE p.username = d.username) THEN d.username || '_dc' ELSE d.username END AS username,
       d.username AS dc_username
FROM sidewalk_dc_login.sidewalk_user d
WHERE d.user_id NOT IN (SELECT dc_user_id FROM dc_migration_user_map);

-- Apply: drop the city schema's FKs into DC's own login schema, remap ids, insert the new accounts, re-add the FKs
-- against the shared schema.
DO $do$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
           WHERE contype = 'f' AND connamespace = 'sidewalk_dc'::regnamespace
             AND confrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'sidewalk_dc_login'::regnamespace) LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $do$;

-- Rows that identify one row per user can't survive two DC accounts merging into one: keep one (user_stat is
-- recomputed nightly, user_current_region is a convenience, auth_tokens are transient).
DELETE FROM sidewalk_dc.user_stat s USING dc_migration_user_map m
WHERE s.user_id = m.dc_user_id AND m.dc_user_id <> m.prod_user_id
  AND EXISTS (SELECT 1 FROM sidewalk_dc.user_stat s2 JOIN dc_migration_user_map m2 ON m2.dc_user_id = s2.user_id
              WHERE m2.prod_user_id = m.prod_user_id AND (s2.meters_audited, s2.user_id) > (s.meters_audited, s.user_id));
DELETE FROM sidewalk_dc.user_stat s USING dc_migration_user_map m
WHERE s.user_id = m.dc_user_id AND m.dc_user_id <> m.prod_user_id AND EXISTS (SELECT 1 FROM sidewalk_dc.user_stat s2 WHERE s2.user_id = m.prod_user_id);
DELETE FROM sidewalk_dc.user_current_region ucr USING dc_migration_user_map m
WHERE ucr.user_id = m.dc_user_id AND m.dc_user_id <> m.prod_user_id
  AND EXISTS (SELECT 1 FROM sidewalk_dc.user_current_region u2 JOIN dc_migration_user_map m2 ON m2.dc_user_id = u2.user_id
              WHERE m2.prod_user_id = m.prod_user_id AND u2.user_current_region_id > ucr.user_current_region_id);
DELETE FROM sidewalk_dc.user_team t USING dc_migration_user_map m
WHERE t.user_id = m.dc_user_id AND m.dc_user_id <> m.prod_user_id
  AND EXISTS (SELECT 1 FROM sidewalk_dc.user_team t2 JOIN dc_migration_user_map m2 ON m2.dc_user_id = t2.user_id
              WHERE m2.prod_user_id = m.prod_user_id AND t2.user_team_id > t.user_team_id);
TRUNCATE sidewalk_dc.auth_tokens;

DO $do$
DECLARE c record;
BEGIN
  FOR c IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'sidewalk_dc' AND column_name IN ('user_id', 'edited_by') AND table_name <> 'dc_migration_user_map' LOOP
    EXECUTE format('UPDATE sidewalk_dc.%I t SET %I = m.prod_user_id FROM sidewalk_dc.dc_migration_user_map m WHERE t.%I = m.dc_user_id AND m.dc_user_id <> m.prod_user_id',
                   c.table_name, c.column_name, c.column_name);
  END LOOP;
END $do$;

INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email) SELECT user_id, username, email FROM dc_new_user;
CREATE TEMP TABLE dc_li_map AS
SELECT l.login_info_id AS old_id, nextval('sidewalk_login.login_info_login_info_id_seq') AS new_id, l.provider_id, l.provider_key
FROM sidewalk_dc_login.login_info l
WHERE l.login_info_id IN (SELECT login_info_id FROM sidewalk_dc_login.user_login_info WHERE user_id IN (SELECT user_id FROM dc_new_user));
INSERT INTO sidewalk_login.login_info (login_info_id, provider_id, provider_key) SELECT new_id, provider_id, provider_key FROM dc_li_map;
INSERT INTO sidewalk_login.user_login_info (login_info_id, user_id)
SELECT m.new_id, uli.user_id FROM sidewalk_dc_login.user_login_info uli JOIN dc_li_map m ON m.old_id = uli.login_info_id;
INSERT INTO sidewalk_login.user_password_info (login_info_id, password, salt, hasher)
SELECT m.new_id, p.password, p.salt, p.hasher FROM sidewalk_dc_login.user_password_info p JOIN dc_li_map m ON m.old_id = p.login_info_id;
INSERT INTO sidewalk_login.user_role (user_id, role, community_service)
SELECT r.user_id, r.role::text::sidewalk_login.role, r.community_service FROM sidewalk_dc_login.user_role r WHERE r.user_id IN (SELECT user_id FROM dc_new_user);

-- The canonical cross-schema set (337.sql), plus the ones the 2024 split gave every city.
ALTER TABLE sidewalk_dc.label ADD CONSTRAINT label_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.street_edge_issue ADD CONSTRAINT street_edge_issue_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.audit_task_comment ADD CONSTRAINT audit_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.user_mistake_response ADD CONSTRAINT user_mistake_response_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.auth_tokens ADD CONSTRAINT auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.user_current_region ADD CONSTRAINT user_current_region_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id) ON DELETE CASCADE;
ALTER TABLE sidewalk_dc.audit_task ADD CONSTRAINT audit_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.gallery_task_environment ADD CONSTRAINT gallery_task_environment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.gallery_task_interaction ADD CONSTRAINT gallery_task_interaction_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.label_history ADD CONSTRAINT label_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.label_validation ADD CONSTRAINT label_validation_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.mission ADD CONSTRAINT mission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.route ADD CONSTRAINT route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.user_route ADD CONSTRAINT user_route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.user_stat ADD CONSTRAINT user_stat_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.user_survey_option_submission ADD CONSTRAINT user_survey_option_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.user_survey_text_submission ADD CONSTRAINT user_survey_text_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.user_team ADD CONSTRAINT user_org_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.validation_task_comment ADD CONSTRAINT validation_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.webpage_activity ADD CONSTRAINT webpage_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.story ADD CONSTRAINT story_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.voided_label_validation ADD CONSTRAINT voided_label_validation_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.voided_label_history ADD CONSTRAINT voided_label_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_dc.label_edit ADD CONSTRAINT label_edit_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);

-- Beyond the FKs, survey_question.survey_user_role (372's role enum) and the label_comments_agg view (370, joins
-- sidewalk_user) resolve to sidewalk_dc_login in the packaged dump, and the CASCADE below would silently take both.
-- Re-point them at the shared schema, then refuse the drop while anything in the city schema still depends on it.
ALTER TABLE sidewalk_dc.survey_question ALTER COLUMN survey_user_role DROP DEFAULT;
ALTER TABLE sidewalk_dc.survey_question ALTER COLUMN survey_user_role TYPE sidewalk_login.role
  USING survey_user_role::text::sidewalk_login.role;
ALTER TABLE sidewalk_dc.survey_question ALTER COLUMN survey_user_role SET DEFAULT 'Registered';
CREATE OR REPLACE VIEW sidewalk_dc.label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp,
                                  'validation', label_validation.validation_result)
                ORDER BY validation_task_comment.timestamp)::text AS comments
FROM sidewalk_dc.validation_task_comment
INNER JOIN sidewalk_login.sidewalk_user ON validation_task_comment.user_id = sidewalk_user.user_id
LEFT JOIN sidewalk_dc.label_validation ON validation_task_comment.label_id = label_validation.label_id
    AND validation_task_comment.user_id = label_validation.user_id
GROUP BY validation_task_comment.label_id;
DO $do$
DECLARE leftover TEXT;
BEGIN
  SELECT string_agg(DISTINCT dep, ', ') INTO leftover FROM (
    SELECT CASE WHEN d.classid = 'pg_class'::regclass THEN d.objid::regclass::text || COALESCE('.' || a.attname, '')
                WHEN d.classid = 'pg_rewrite'::regclass THEN r.ev_class::regclass::text
                ELSE con.conrelid::regclass::text || ' constraint ' || con.conname END AS dep
    FROM pg_depend d
    LEFT JOIN pg_rewrite r ON d.classid = 'pg_rewrite'::regclass AND r.oid = d.objid
    LEFT JOIN pg_constraint con ON d.classid = 'pg_constraint'::regclass AND con.oid = d.objid
    LEFT JOIN pg_attribute a ON d.classid = 'pg_class'::regclass AND a.attrelid = d.objid AND a.attnum = d.objsubid
    JOIN pg_class owner ON owner.oid = COALESCE(r.ev_class, con.conrelid, d.objid)
      AND owner.relnamespace = 'sidewalk_dc'::regnamespace
    WHERE d.classid IN ('pg_class'::regclass, 'pg_rewrite'::regclass, 'pg_constraint'::regclass)
      AND ((d.refclassid = 'pg_class'::regclass
            AND d.refobjid IN (SELECT oid FROM pg_class WHERE relnamespace = 'sidewalk_dc_login'::regnamespace))
        OR (d.refclassid = 'pg_type'::regclass
            AND d.refobjid IN (SELECT oid FROM pg_type WHERE typnamespace = 'sidewalk_dc_login'::regnamespace)))
  ) s;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'sidewalk_dc still depends on sidewalk_dc_login (the CASCADE would drop these): %', leftover;
  END IF;
END $do$;
DROP SCHEMA sidewalk_dc_login CASCADE;
DROP INDEX sidewalk_login.dc_tmp_lower_email_idx;

-- Report.
SELECT 'mapped' AS what, how, count(*) FROM dc_migration_user_map GROUP BY how
UNION ALL SELECT 'inserted', '', count(*) FROM dc_new_user
UNION ALL SELECT 'inserted with _dc suffix', string_agg(dc_username || ' -> ' || username, ', '), count(*) FROM dc_new_user WHERE username <> dc_username
UNION ALL SELECT 'dc-internal merges', string_agg(dc_username || ' -> ' || prod_username, ', '), count(*) FROM dc_migration_user_map WHERE how LIKE 'dc duplicate%'
UNION ALL SELECT 'orphan user_ids left in sidewalk_dc.label', '', count(*) FROM sidewalk_dc.label WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.sidewalk_user u WHERE u.user_id = label.user_id)
ORDER BY 1, 2;
