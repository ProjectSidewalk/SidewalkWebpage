# --- !Ups
-- #5306: the community service flag moved to sidewalk_login.user_settings in 385.sql (#3720), and every prod and test
-- city has applied 385 and runs a release that no longer reads the old column. Each city's run after the first finds
-- the column already gone.
ALTER TABLE sidewalk_login.user_role DROP COLUMN IF EXISTS community_service;

# --- !Downs
-- The release before this one still reads and writes user_role.community_service, so the column comes back filled
-- from user_settings. Each city's run after the first finds the column already there, and re-copying is harmless.
ALTER TABLE sidewalk_login.user_role ADD COLUMN IF NOT EXISTS community_service BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE sidewalk_login.user_role
SET community_service = TRUE
FROM sidewalk_login.user_settings
WHERE user_settings.user_id = user_role.user_id AND user_settings.community_service;
