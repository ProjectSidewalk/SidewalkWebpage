# --- !Ups
-- Finding the one AI account read every user_role row, about 19,000 times a day on prod (#5238).
-- This runs once per city on a shared table, and CREATE INDEX locks the table even when the index is already there
-- (as on prod and test, where it was built CONCURRENTLY), holding up sign-ups everywhere. Hence the check first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE schemaname = 'sidewalk_login' AND indexname = 'user_role_role_idx') THEN
    CREATE INDEX IF NOT EXISTS user_role_role_idx ON sidewalk_login.user_role (role);;
  END IF;;
END $$;

# --- !Downs
DROP INDEX IF EXISTS sidewalk_login.user_role_role_idx;
