# --- !Ups
-- Account-wide user data in the shared sidewalk_login schema, so it follows a user from city to city (#3720).
-- user_settings holds choices the user makes on the Settings page, and user_state holds what the site records about
-- them. Rows are only written once there's something to store, so a user with no row has every default.

-- Evolutions run once per city schema and CREATE TYPE has no IF NOT EXISTS form, so the enum is guarded on pg_type.
-- Semicolons inside the block are doubled to survive Play's statement splitter (see docs/evolutions.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type
                 WHERE typname = 'measurement_system' AND typnamespace = 'sidewalk_login'::regnamespace) THEN
    CREATE TYPE sidewalk_login.measurement_system AS ENUM ('metric', 'imperial');;
    -- Otherwise the first city role to get here owns the type, and no other city could ever alter or drop it.
    ALTER TYPE sidewalk_login.measurement_system OWNER TO sidewalk;;
  END IF;;
END $$;

-- A NULL measurement_system means "follow the site language".
CREATE TABLE IF NOT EXISTS sidewalk_login.user_settings (
  user_id TEXT PRIMARY KEY REFERENCES sidewalk_login.sidewalk_user (user_id),
  measurement_system sidewalk_login.measurement_system,
  community_service BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE sidewalk_login.user_settings OWNER TO sidewalk;

-- user_role.community_service is copied rather than moved. Prod restarts cities one at a time, and a city still on the
-- old code reads that column on every page, so it's dropped in a later release (#5306). The join skips any user_role
-- row whose account is missing, which the FK would otherwise reject.
INSERT INTO sidewalk_login.user_settings (user_id, community_service)
SELECT user_role.user_id, TRUE
FROM sidewalk_login.user_role
INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = user_role.user_id
WHERE user_role.community_service
ON CONFLICT (user_id) DO NOTHING;

-- A NULL explore_tutorial_completed_at means the user hasn't finished or skipped the Explore tutorial anywhere yet.
CREATE TABLE IF NOT EXISTS sidewalk_login.user_state (
  user_id TEXT PRIMARY KEY REFERENCES sidewalk_login.sidewalk_user (user_id),
  explore_tutorial_completed_at TIMESTAMPTZ
);
ALTER TABLE sidewalk_login.user_state OWNER TO sidewalk;

-- Each city's run adds the users who finished the tutorial in that city, keeping the earliest time across cities.
-- Skipping it also marks the mission completed, and counts as done. The join leaves out missions from accounts that
-- no longer exist, which some cities have (#4589).
INSERT INTO sidewalk_login.user_state (user_id, explore_tutorial_completed_at)
SELECT mission.user_id, MIN(mission.mission_end)
FROM mission
INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = mission.user_id
WHERE mission.mission_type = 'auditOnboarding' AND mission.completed = TRUE
GROUP BY mission.user_id
ON CONFLICT (user_id) DO UPDATE
SET explore_tutorial_completed_at =
  LEAST(user_state.explore_tutorial_completed_at, EXCLUDED.explore_tutorial_completed_at);

# --- !Downs
-- The old code reads community_service from user_role, so changes made since the Ups are copied back first. Downs run
-- once per city too, so every run after the first finds the tables already gone.
DO $$
BEGIN
  IF to_regclass('sidewalk_login.user_settings') IS NOT NULL THEN
    UPDATE sidewalk_login.user_role SET community_service = user_settings.community_service
    FROM sidewalk_login.user_settings
    WHERE user_role.user_id = user_settings.user_id;;
  END IF;;
END $$;

DROP TABLE IF EXISTS sidewalk_login.user_state;
DROP TABLE IF EXISTS sidewalk_login.user_settings;
DROP TYPE IF EXISTS sidewalk_login.measurement_system;
