# --- !Ups
-- Auth schema cleanup and constraints (#5317): sign-in found a password by email while reset and change-password
-- found it by account, and nothing stopped an email from having several login rows or accounts, so they could disagree.
--
-- Everything here is in the shared sidewalk_login schema and evolutions run once per city, so the script is one plpgsql
-- block that exits once the index it creates last exists, with doubled semicolons (docs/evolutions.md). The
-- cleanup reads the 6M-row auth tables as hash joins, never per-row lookups: under a minute on prod, once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'sidewalk_login' AND indexname = 'login_info_provider_key_key') THEN

    -- Cities restart one at a time, so sign-ups from other cities keep coming while this runs. Locking up front, in
    -- sign-up's write order, lets an in-flight sign-up finish rather than deadlock against the ALTERs below.
    LOCK TABLE sidewalk_login.sidewalk_user, sidewalk_login.login_info, sidewalk_login.user_login_info,
      sidewalk_login.user_password_info, sidewalk_login.user_role IN ACCESS EXCLUSIVE MODE;;

    -- === Rows the constraints below would reject. Each step is a no-op on clean data. ===

    -- Login links whose account is gone: none on prod (the FK forbids it), a few in dev copies with a DC sandbox.
    DELETE FROM sidewalk_login.user_login_info
    WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.sidewalk_user
                      WHERE sidewalk_user.user_id = user_login_info.user_id);;

    -- A login row linked to several accounts: the first account by id keeps it, the rest lose it (none on prod).
    DELETE FROM sidewalk_login.user_login_info
    USING (SELECT login_info_id, min(user_id) AS keep_user_id
           FROM sidewalk_login.user_login_info GROUP BY login_info_id HAVING count(*) > 1) AS shared
    WHERE user_login_info.login_info_id = shared.login_info_id AND user_login_info.user_id <> shared.keep_user_id;;

    -- An account with several login rows keeps only its newest. None on prod.
    DELETE FROM sidewalk_login.user_login_info
    USING (SELECT user_id, max(login_info_id) AS keep_login_info_id
           FROM sidewalk_login.user_login_info GROUP BY user_id HAVING count(*) > 1) AS multi
    WHERE user_login_info.user_id = multi.user_id AND user_login_info.login_info_id <> multi.keep_login_info_id;;

    -- Login rows no account points at (1,187 on prod, from the pre-v9 sign-up code's non-atomic writes). Unreachable:
    -- sign-in needs the account link they lack.
    DELETE FROM sidewalk_login.user_password_info
    WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.user_login_info
                      WHERE user_login_info.login_info_id = user_password_info.login_info_id);;
    DELETE FROM sidewalk_login.login_info
    WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.user_login_info
                      WHERE user_login_info.login_info_id = login_info.login_info_id);;

    -- Several passwords for one login row: keep the newest. None on prod.
    DELETE FROM sidewalk_login.user_password_info
    USING (SELECT login_info_id, max(user_password_info_id) AS keep_id
           FROM sidewalk_login.user_password_info GROUP BY login_info_id HAVING count(*) > 1) AS multi
    WHERE user_password_info.login_info_id = multi.login_info_id
      AND user_password_info.user_password_info_id <> multi.keep_id;;

    -- One email shared by several accounts (8 emails on prod, from June 2025 when the duplicate check was broken). The
    -- keeper per email has the most labels, then audit tasks, then is the newest (activity sweep in the issue). The
    -- rest keep their data under "<first 8 of user_id>.<email>", the rename db/scripts/import-users.sh uses. The Downs
    -- can't undo a rename, so a re-applied Ups must not prefix twice.
    UPDATE sidewalk_login.sidewalk_user
    SET email = left(user_id, 8) || '.' || email
    WHERE email NOT LIKE left(user_id, 8) || '.%' AND user_id IN (
      '1b2a6df8-01d2-4321-8110-e95389eeb53c',
      '23025b4b-4559-45b5-b0dd-d23de63bc2fa',
      '23dc0674-1552-47e2-8a59-be16719393aa',
      '58c58a4d-4bee-4fe1-871d-dd1ca8caab2b',
      '66e526c1-ff36-485d-881d-b5cf1f822653',
      '721e92fc-ff48-4c49-b95f-f08d05cbc264',
      '76d7bbab-345e-4bc0-a519-87d287d988fd',
      '82c27a0f-91e7-412b-9b0e-f17fc53384e4',
      '8470be88-d99d-416a-a801-29b12ac64c85',
      '8db46a88-9bd7-4bbe-8475-dd375ec287f1',
      '9a78bb44-18c0-40d3-a2a2-cbfe9dde9b70',
      'a18716f3-010e-49b7-bfb7-7e2f39ce75fe',
      'b2bec21c-528a-48b0-90e8-f78a97c40f00',
      'bcc8ec0d-72a2-4da7-a9d9-7f4337f859fa',
      'dc217328-1ab1-432f-9b75-98d7d6be6b39',
      'dde7f29b-295e-4c8f-867f-4eea90cb797f'
    );;

    -- Any email still shared (none on prod, but other deployments may differ): the oldest login row keeps it.
    UPDATE sidewalk_login.sidewalk_user
    SET email = left(sidewalk_user.user_id, 8) || '.' || sidewalk_user.email
    FROM (SELECT sidewalk_user.user_id,
                 row_number() OVER (PARTITION BY lower(sidewalk_user.email)
                                    ORDER BY user_login_info.login_info_id NULLS LAST, sidewalk_user.user_id) AS rank
          FROM sidewalk_login.sidewalk_user
          LEFT JOIN sidewalk_login.user_login_info ON user_login_info.user_id = sidewalk_user.user_id
          WHERE lower(sidewalk_user.email) IN (SELECT lower(email) FROM sidewalk_login.sidewalk_user
                                               GROUP BY lower(email) HAVING count(*) > 1)) AS ranked
    WHERE sidewalk_user.user_id = ranked.user_id AND ranked.rank > 1;;

    -- Emails are stored lower-cased (156.sql, and every write path since), which the CHECKs below now enforce.
    UPDATE sidewalk_login.sidewalk_user SET email = lower(email) WHERE email <> lower(email);;

    -- Carries the renames above over to the login rows (and fixes any other drift, none on prod).
    UPDATE sidewalk_login.login_info
    SET provider_key = sidewalk_user.email
    FROM sidewalk_login.user_login_info
    INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = user_login_info.user_id
    WHERE user_login_info.login_info_id = login_info.login_info_id AND login_info.provider_key <> sidewalk_user.email;;

    -- === The constraints. A unique index replaces the plain index on the same column. ===

    ALTER TABLE sidewalk_login.user_login_info
      ADD CONSTRAINT user_login_info_user_id_key UNIQUE (user_id),
      ADD CONSTRAINT user_login_info_login_info_id_key UNIQUE (login_info_id);;
    DROP INDEX IF EXISTS sidewalk_login.user_login_info_user_id_idx;;
    DROP INDEX IF EXISTS sidewalk_login.user_login_info_login_info_id_idx;;

    -- Also the first index on this column: every sign-in read the whole 6M-row table to find a password.
    ALTER TABLE sidewalk_login.user_password_info
      ADD CONSTRAINT user_password_info_login_info_id_key UNIQUE (login_info_id);;

    ALTER TABLE sidewalk_login.user_role ADD CONSTRAINT user_role_user_id_key UNIQUE (user_id);;
    DROP INDEX IF EXISTS sidewalk_login.user_role_user_id_idx;;

    -- Exact-match rather than lower(): with the CHECK it's case-insensitive anyway, and it doubles as the lookup index.
    -- The site-wide anonymous account and SidewalkAI have no login row on purpose, so this is what covers them.
    ALTER TABLE sidewalk_login.sidewalk_user
      ADD CONSTRAINT sidewalk_user_email_lower_check CHECK (email = lower(email)),
      ADD CONSTRAINT sidewalk_user_email_key UNIQUE (email);;
    DROP INDEX IF EXISTS sidewalk_login.email_idx;;

    -- Same for login rows, and sign-in scanned the whole table for this one too. The guard at the top checks for this
    -- index, so it goes last.
    ALTER TABLE sidewalk_login.login_info
      ADD CONSTRAINT login_info_provider_key_lower_check CHECK (provider_key = lower(provider_key)),
      ADD CONSTRAINT login_info_provider_key_key UNIQUE (provider_key);;
  END IF;;
END $$;

# --- !Downs
-- The row cleanup can't be undone. This drops the constraints and restores the plain indexes they replaced.
ALTER TABLE sidewalk_login.login_info
  DROP CONSTRAINT IF EXISTS login_info_provider_key_key,
  DROP CONSTRAINT IF EXISTS login_info_provider_key_lower_check;
ALTER TABLE sidewalk_login.sidewalk_user
  DROP CONSTRAINT IF EXISTS sidewalk_user_email_key,
  DROP CONSTRAINT IF EXISTS sidewalk_user_email_lower_check;
CREATE INDEX IF NOT EXISTS email_idx ON sidewalk_login.sidewalk_user (email);
ALTER TABLE sidewalk_login.user_role DROP CONSTRAINT IF EXISTS user_role_user_id_key;
CREATE INDEX IF NOT EXISTS user_role_user_id_idx ON sidewalk_login.user_role (user_id);
ALTER TABLE sidewalk_login.user_password_info DROP CONSTRAINT IF EXISTS user_password_info_login_info_id_key;
ALTER TABLE sidewalk_login.user_login_info
  DROP CONSTRAINT IF EXISTS user_login_info_user_id_key,
  DROP CONSTRAINT IF EXISTS user_login_info_login_info_id_key;
CREATE INDEX IF NOT EXISTS user_login_info_user_id_idx ON sidewalk_login.user_login_info (user_id);
CREATE INDEX IF NOT EXISTS user_login_info_login_info_id_idx ON sidewalk_login.user_login_info (login_info_id);
