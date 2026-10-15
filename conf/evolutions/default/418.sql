# --- !Ups
-- #5306: the community service flag moved to sidewalk_login.user_settings in 385.sql (#3720), and every prod and test
-- city has applied 385 and runs a release that no longer reads the old column. The drop locks user_role, which every
-- page load reads, so the check keeps each city's run after the first from taking that lock at all.
-- Semicolons inside the block are doubled to survive Play's statement splitter (see docs/evolutions.md).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'sidewalk_login' AND table_name = 'user_role'
               AND column_name = 'community_service') THEN
    ALTER TABLE sidewalk_login.user_role DROP COLUMN community_service;;
  END IF;;
END $$;

# --- !Downs
-- The release before this one still writes user_role.community_service, so the column comes back filled from
-- user_settings. Each city's run after the first only fixes rows that changed since, in either direction.
ALTER TABLE sidewalk_login.user_role ADD COLUMN IF NOT EXISTS community_service BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE sidewalk_login.user_role
SET community_service = user_settings.community_service
FROM sidewalk_login.user_settings
WHERE user_settings.user_id = user_role.user_id
  AND user_role.community_service IS DISTINCT FROM user_settings.community_service;
