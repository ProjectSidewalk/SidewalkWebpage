# --- !Ups
-- Removes @ from usernames (#5301) so the name shown on public pages is the real one that profile links resolve.
--
-- Everything here is in the shared sidewalk_login schema and evolutions run once per city, so the script is one plpgsql
-- block that exits once the CHECK it adds exists, with doubled semicolons (docs/evolutions.md).
DO $$
DECLARE
  renamed RECORD;;
  candidate TEXT;;
  suffix INT;;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'sidewalk_login.sidewalk_user'::regclass
                   AND conname = 'sidewalk_user_username_no_at_check') THEN

    -- Blocks sign-ups and renames from other cities while this runs, so none can grab a name picked below. This mode
    -- still lets foreign-key checks through, so writes to tables that point at sidewalk_user don't wait.
    LOCK TABLE sidewalk_login.sidewalk_user IN SHARE ROW EXCLUSIVE MODE;;

    -- Checked again: another city may have done all of this while this one waited for the lock.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'sidewalk_login.sidewalk_user'::regclass
                     AND conname = 'sidewalk_user_username_no_at_check') THEN

      -- A non-email like "Roland@SciStarter" meant the @ as part of the name, so it keeps the rest. The comma
      -- catches a mistyped email (one account has "gmail,com"). Spaces are trimmed because Settings trims the name
      -- before saving and would otherwise see a rename on every save.
      -- This and the next statement scan the whole 6M-row table without an index, which is fine: a few seconds, once.
      CREATE TEMP TABLE username_5301_renames AS
      SELECT user_id,
             btrim(CASE WHEN username ~ '^[^@]+@[^@]+[.,][^@]+$' THEN split_part(username, '@', 1)
                        ELSE replace(username, '@', '_') END) AS base
      FROM sidewalk_login.sidewalk_user
      WHERE username LIKE '%@%';;

      -- Case-insensitive, so "anna" can't sit next to an existing "Anna".
      CREATE TEMP TABLE username_5301_taken AS
      SELECT lower(username) AS name
      FROM sidewalk_login.sidewalk_user
      WHERE username NOT LIKE '%@%'
        AND lower(username) IN (SELECT lower(base) FROM username_5301_renames)
      UNION
      SELECT lower(username)
      FROM sidewalk_login.sidewalk_user
      WHERE username NOT LIKE '%@%'
        AND lower(regexp_replace(username, '_[0-9]+$', '')) IN (SELECT lower(base) FROM username_5301_renames);;

      -- An account that already has the name keeps it.
      FOR renamed IN SELECT user_id, base FROM username_5301_renames ORDER BY user_id LOOP
        candidate := renamed.base;;
        suffix := 1;;
        WHILE EXISTS (SELECT 1 FROM username_5301_taken WHERE name = lower(candidate)) LOOP
          suffix := suffix + 1;;
          candidate := renamed.base || '_' || suffix;;
        END LOOP;;
        INSERT INTO username_5301_taken (name) VALUES (lower(candidate));;
        UPDATE sidewalk_login.sidewalk_user SET username = candidate WHERE user_id = renamed.user_id;;
      END LOOP;;

      DROP TABLE username_5301_renames, username_5301_taken;;

      ALTER TABLE sidewalk_login.sidewalk_user
        ADD CONSTRAINT sidewalk_user_username_no_at_check CHECK (username NOT LIKE '%@%');;
    END IF;;
  END IF;;
END $$;

# --- !Downs
-- The renames can't be undone. This only drops the constraint.
ALTER TABLE sidewalk_login.sidewalk_user DROP CONSTRAINT IF EXISTS sidewalk_user_username_no_at_check;
