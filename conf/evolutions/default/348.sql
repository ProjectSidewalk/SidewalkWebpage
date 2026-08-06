# --- !Ups
-- Enforce one user_stat row per user (issue #4604). This was left out of the constraint pass in 338 because the
-- duplicates had to be traced to their source first: every request from a signed-in user ran a read-then-insert to
-- create the row on first visit to a city, so the parallel requests of that first page load could each see "no row"
-- and each insert one. The insert is now a single ON CONFLICT DO NOTHING statement, which needs this constraint to
-- have anything to conflict on.

-- Collapse duplicate rows to one per user, keeping the row ranked first. The duplicates observed are identical
-- all-zero rows, so the ranking almost always falls through to the lowest user_stat_id. It keeps an admin's exclusion
-- or manual quality override first, then the row with the most activity, in case some city has duplicates that
-- aren't identical.
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
        ORDER BY excluded DESC, (high_quality_manual IS NOT NULL) DESC, meters_audited DESC,
          own_labels_validated DESC, user_stat_id
      ) AS dupe_rank
    FROM user_stat
    WHERE user_id IN (SELECT user_id FROM user_stat GROUP BY user_id HAVING COUNT(*) > 1)
  ) ranked
  WHERE dupe_rank > 1
);

ALTER TABLE user_stat ADD CONSTRAINT user_stat_user_id_key UNIQUE (user_id);

-- The constraint's unique index supersedes the plain user_id index added in 296.
DROP INDEX user_stat_user_id_idx;

# --- !Downs
-- The dedup DELETE above is a data change and is not restored on rollback.
CREATE INDEX user_stat_user_id_idx ON user_stat (user_id);
ALTER TABLE user_stat DROP CONSTRAINT IF EXISTS user_stat_user_id_key;
