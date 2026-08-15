# --- !Ups
-- Enforce one user_stat row per user (issue #4604). This was left out of the constraint pass in 338 because the
-- duplicates had to be traced to their source first: every request from a signed-in user ran a read-then-insert to
-- create the row on first visit to a city, so the parallel requests of that first page load could each see "no row"
-- and each insert one. The insert is now a single ON CONFLICT DO NOTHING statement, which needs this constraint to
-- have anything to conflict on.
--
-- Note for anyone reading 347.sql: its comment at the high_quality UPDATE says user_id carries no UNIQUE constraint
-- and duplicate rows exist. That stops being true here. 347 can't be edited to say so, since Play hashes applied
-- evolutions and autoApplyDowns would re-run its 11s PostGIS migration.

-- Collapse duplicate rows to one per user, keeping the row ranked first. The duplicates observed are identical
-- all-zero rows, so the ranking almost always falls through to the lowest user_stat_id. Ahead of that it keeps the
-- values a wrong choice would be irreversible for, in case some city has duplicates that aren't identical: an admin's
-- exclusion, then the more private of the two privacy settings, then a manual quality override, then activity.
--
-- The privacy terms sort ASC so FALSE wins. They can legitimately differ between duplicates on a
-- private-profiles-by-default city, and picking the public row would publish a user who never opted in -- which the
-- Downs cannot undo, unlike every other column here.
--
-- The row_number window is restricted to users that actually have duplicates, and the outer filter is IN rather than
-- NOT IN, because those are the two things that keep this linear. A NOT IN over a whole-table subquery cannot be
-- hashed, so Postgres rescans the subquery per row: on a city with ~390k user_stat rows that plan costs ~5 billion
-- and never finishes.
DELETE FROM user_stat
WHERE user_stat_id IN (
  SELECT user_stat_id
  FROM (
    SELECT user_stat_id,
      row_number() OVER (
        PARTITION BY user_id
        ORDER BY excluded DESC, on_leaderboard, public_profile, (high_quality_manual IS NOT NULL) DESC,
          meters_audited DESC, own_labels_validated DESC, user_stat_id
      ) AS dupe_rank
    FROM user_stat
    WHERE user_id IN (SELECT user_id FROM user_stat GROUP BY user_id HAVING COUNT(*) > 1)
  ) ranked
  WHERE dupe_rank > 1
);

ALTER TABLE user_stat ADD CONSTRAINT user_stat_user_id_key UNIQUE (user_id);

-- The constraint's unique index supersedes the plain user_id index added in 296. IF EXISTS because new city schemas
-- are restored from the committed sidewalk_init dump and fast-forwarded rather than replaying evolutions from 1, so
-- their index set is whatever that template carries -- a bare DROP INDEX would fail the whole evolution for that city.
DROP INDEX IF EXISTS user_stat_user_id_idx;

-- Defaults for the columns every insert path was hand-writing the same literal into. With these, the app's insert
-- names only user_id and the two privacy flags, so adding a NOT NULL column here later can't silently break it.
ALTER TABLE user_stat ALTER COLUMN meters_audited SET DEFAULT 0;
ALTER TABLE user_stat ALTER COLUMN high_quality SET DEFAULT TRUE;
ALTER TABLE user_stat ALTER COLUMN excluded SET DEFAULT FALSE;

# --- !Downs
-- Only safe alongside a rollback of the code that ships with it: UserStatTable.insertIfNew says ON CONFLICT (user_id),
-- which errors outright once the constraint is gone, and CustomSecurityService calls it on every request from an
-- identified user. Note autoApplyDowns=true will run this without anyone choosing to roll back if this file is edited
-- after it has already applied somewhere.
--
-- The dedup DELETE above is a data change and is not restored on rollback.
ALTER TABLE user_stat ALTER COLUMN excluded DROP DEFAULT;
ALTER TABLE user_stat ALTER COLUMN high_quality DROP DEFAULT;
ALTER TABLE user_stat ALTER COLUMN meters_audited DROP DEFAULT;
CREATE INDEX IF NOT EXISTS user_stat_user_id_idx ON user_stat (user_id);
ALTER TABLE user_stat DROP CONSTRAINT IF EXISTS user_stat_user_id_key;
