# --- !Ups
-- Convert the sidewalk_login.role lookup table into a `role` Postgres enum (#4103). This kills two hand-maintained
-- Scala copies of the table's rows that nothing validated: RoleTable.VALID_ROLES and UserRoleTable.roleToId, the
-- latter of which had already drifted (it never gained the 'AI' role added in 328.sql).
--
-- sidewalk_login is shared by every city, but an evolution runs once per city schema, so the shared half below has to
-- be a no-op on runs 2..N. Everything it does except CREATE TYPE has an IF [NOT] EXISTS form, so the whole half sits
-- in a plpgsql DO block guarded on pg_type. Play splits an evolution on every single semicolon, so semicolons inside
-- the block are doubled to survive the split (precedent: 276.sql, which shipped a dollar-quoted body to prod).
DO $$
DECLARE
  fk RECORD;;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type
             WHERE typname = 'role' AND typnamespace = 'sidewalk_login'::regnamespace AND typtype = 'e') THEN
    RETURN;;
  END IF;;

  -- The per-city half below runs after the lookup table is gone, so it maps ids to names from a hardcoded list. Assert
  -- that list against the real rows here, so a deployment whose ids ever drifted fails loudly instead of silently
  -- relabeling every survey question.
  IF (SELECT COUNT(*) FROM sidewalk_login.role) <> 7
     OR EXISTS (SELECT 1 FROM sidewalk_login.role
                WHERE (role_id, role) NOT IN ((1, 'Registered'), (2, 'Turker'), (3, 'Researcher'),
                                              (4, 'Administrator'), (5, 'Owner'), (6, 'Anonymous'), (7, 'AI'))) THEN
    RAISE EXCEPTION 'sidewalk_login.role does not match the canonical role id to name map, so 371.sql cannot run';;
  END IF;;

  -- Every city's survey_question points at this table, and the table cannot be dropped while any of those FKs stand.
  -- A city that has not yet run its own evolutions keeps working on its int column, just without the FK, until it
  -- does. Includes user_role's own FK where a deployment has one (some are missing it, see #4589).
  FOR fk IN SELECT conrelid::regclass AS constrained_table, conname
            FROM pg_constraint WHERE confrelid = 'sidewalk_login.role'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.constrained_table, fk.conname);;
  END LOOP;;

  -- Swap user_role.role_id for a role-typed column, taking names from the lookup table rather than the list asserted
  -- above so that a role_id with no matching row lands as NULL and trips the column's NOT NULL.
  ALTER TABLE sidewalk_login.user_role ADD COLUMN role_name TEXT;;
  UPDATE sidewalk_login.user_role SET role_name = role.role
  FROM sidewalk_login.role WHERE user_role.role_id = role.role_id;;
  DROP TABLE sidewalk_login.role;;
  CREATE TYPE sidewalk_login.role AS ENUM
    ('Registered', 'Turker', 'Researcher', 'Administrator', 'Owner', 'Anonymous', 'AI');;
  ALTER TABLE sidewalk_login.user_role
    ALTER COLUMN role_id TYPE sidewalk_login.role USING role_name::sidewalk_login.role;;
  ALTER TABLE sidewalk_login.user_role DROP COLUMN role_name;;
  ALTER TABLE sidewalk_login.user_role RENAME COLUMN role_id TO role;;
  ALTER INDEX IF EXISTS sidewalk_login.user_role_role_id_idx RENAME TO user_role_role_idx;;
END $$;

-- Per-city half: point survey_question at the enum too. This runs exactly once per schema, so it needs no guard. The
-- FK is normally already gone (dropped by whichever city ran the block above first), but a schema cloned from the
-- template between that run and this one would still carry it.
ALTER TABLE survey_question DROP CONSTRAINT IF EXISTS survey_question_survey_user_role_id_fkey;
ALTER TABLE survey_question ALTER COLUMN survey_user_role_id DROP DEFAULT;
ALTER TABLE survey_question
  ALTER COLUMN survey_user_role_id TYPE sidewalk_login.role
  USING (CASE survey_user_role_id
    WHEN 1 THEN 'Registered'
    WHEN 2 THEN 'Turker'
    WHEN 3 THEN 'Researcher'
    WHEN 4 THEN 'Administrator'
    WHEN 5 THEN 'Owner'
    WHEN 6 THEN 'Anonymous'
    WHEN 7 THEN 'AI'
  END)::sidewalk_login.role;
ALTER TABLE survey_question RENAME COLUMN survey_user_role_id TO survey_user_role;
ALTER TABLE survey_question ALTER COLUMN survey_user_role SET DEFAULT 'Registered';

# --- !Downs
-- Per-city half first, so that the shared half can tell when it is the last one running.
ALTER TABLE survey_question ALTER COLUMN survey_user_role DROP DEFAULT;
ALTER TABLE survey_question
  ALTER COLUMN survey_user_role TYPE INT
  USING (CASE survey_user_role
    WHEN 'Registered' THEN 1
    WHEN 'Turker' THEN 2
    WHEN 'Researcher' THEN 3
    WHEN 'Administrator' THEN 4
    WHEN 'Owner' THEN 5
    WHEN 'Anonymous' THEN 6
    WHEN 'AI' THEN 7
  END);
ALTER TABLE survey_question RENAME COLUMN survey_user_role TO survey_user_role_id;
ALTER TABLE survey_question ALTER COLUMN survey_user_role_id SET DEFAULT 1;

-- Shared half, mirroring the Ups: rebuild the lookup table once every city has reverted, which is the point at which
-- user_role.role is the only column left using the type. Cities revert in an arbitrary order, so the FKs are re-added
-- for all of them here rather than by each city on its own way past.
DO $$
DECLARE
  survey_table RECORD;;
BEGIN
  -- Ordinary tables only: the index on user_role.role has pg_attribute rows of the same type and would never let the
  -- count reach 1.
  IF (SELECT COUNT(*) FROM pg_attribute
      JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
      WHERE atttypid = 'sidewalk_login.role'::regtype AND NOT attisdropped AND relkind = 'r') <> 1 THEN
    RETURN;;
  END IF;;

  ALTER TABLE sidewalk_login.user_role RENAME COLUMN role TO role_id;;
  ALTER TABLE sidewalk_login.user_role
    ALTER COLUMN role_id TYPE INT
    USING (CASE role_id
      WHEN 'Registered' THEN 1
      WHEN 'Turker' THEN 2
      WHEN 'Researcher' THEN 3
      WHEN 'Administrator' THEN 4
      WHEN 'Owner' THEN 5
      WHEN 'Anonymous' THEN 6
      WHEN 'AI' THEN 7
    END);;
  ALTER INDEX IF EXISTS sidewalk_login.user_role_role_idx RENAME TO user_role_role_id_idx;;
  DROP TYPE sidewalk_login.role;;

  CREATE TABLE sidewalk_login.role (
    role_id SERIAL PRIMARY KEY,
    role TEXT NOT NULL
  );;
  ALTER TABLE sidewalk_login.role OWNER TO sidewalk;;
  INSERT INTO sidewalk_login.role (role)
  VALUES ('Registered'), ('Turker'), ('Researcher'), ('Administrator'), ('Owner'), ('Anonymous'), ('AI');;

  -- The Ups dropped these FKs to get the table out of the way. Re-adding them cannot fail on orphans: the Ups would
  -- have tripped a NOT NULL on any role_id that had no row here.
  ALTER TABLE sidewalk_login.user_role
    ADD CONSTRAINT user_role_role_id_fkey FOREIGN KEY (role_id) REFERENCES sidewalk_login.role (role_id);;
  FOR survey_table IN SELECT nspname FROM pg_namespace
                      WHERE nspname LIKE 'sidewalk\_%' AND nspname <> 'sidewalk_login'
                        AND to_regclass(nspname || '.survey_question') IS NOT NULL
  LOOP
    EXECUTE format('ALTER TABLE %I.survey_question ADD CONSTRAINT survey_question_survey_user_role_id_fkey '
                   || 'FOREIGN KEY (survey_user_role_id) REFERENCES sidewalk_login.role (role_id)',
                   survey_table.nspname);;
  END LOOP;;
END $$;
