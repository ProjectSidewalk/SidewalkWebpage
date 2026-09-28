# --- !Ups
-- When each account was created (#5532). Existing accounts get the moment this runs until
-- tools/one-off/5532-backfill-user-created-at.sql fills in their first visit, which is too slow to do here.
-- This runs once per city on a shared table, and an ALTER locks the table even when it has nothing to do, holding up
-- sign-ins everywhere until that city's evolutions finish. Hence the check first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'sidewalk_login' AND table_name = 'sidewalk_user'
                   AND column_name = 'created_at') THEN
    ALTER TABLE sidewalk_login.sidewalk_user ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();;
  END IF;;
END $$;

-- Exact copies of the primary key's and the unique username key's own indexes, so they only slowed writes down.
DROP INDEX IF EXISTS sidewalk_login.user_id_idx;
DROP INDEX IF EXISTS sidewalk_login.username_idx;

# --- !Downs
-- Deliberately empty. Dropping the column would throw away the backfilled dates and break sign-up in every city still
-- on this release, and older code works with it there.
