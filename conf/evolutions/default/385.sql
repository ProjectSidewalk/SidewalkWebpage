# --- !Ups
-- Account-wide user data in the shared sidewalk_login schema, so it follows a user from city to city (#3720).
-- user_settings holds choices the user makes on the Settings page, and user_account_state holds what the site records
-- about them. Rows are only written once there's something to store, so a user with no row has every default.

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

-- Prod restarts cities one at a time, so for a few minutes some cities still run the previous release, which reads and
-- writes user_role.community_service. Until #5306 drops that column, this release writes the flag to both places, so
-- user_role stays current and each city's run can sync user_settings from it. That also carries over changes made in
-- cities that hadn't restarted yet. The join skips any user_role row whose account is missing, which the FK would
-- reject. user_role has no index on community_service, so this reads the whole table: about 0.3 s for the 6.2M rows
-- in the dev copy of the prod users dump. The column is dropped soon, so an index isn't worth building.
INSERT INTO sidewalk_login.user_settings (user_id, community_service)
SELECT user_role.user_id, BOOL_OR(user_role.community_service)
FROM sidewalk_login.user_role
INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = user_role.user_id
LEFT JOIN sidewalk_login.user_settings ON user_settings.user_id = user_role.user_id
WHERE user_role.community_service OR user_settings.user_id IS NOT NULL
GROUP BY user_role.user_id
ON CONFLICT (user_id) DO UPDATE SET community_service = EXCLUDED.community_service;

-- The previous release kept a units choice only in a per-city cookie, which this release doesn't read, but it also
-- logged every change as Click_module=ChangeUnits_from=<choice>_to=<choice>. Each user's latest change in this city
-- becomes their saved choice unless their account already has one. A latest choice of "auto" means no saved choice.
-- webpage_activity has no index on activity, so this reads the whole table: about 0.1 s for the dev DB's 2.2M-row
-- Seattle table.
INSERT INTO sidewalk_login.user_settings (user_id, measurement_system)
SELECT latest_change.user_id, latest_change.choice::sidewalk_login.measurement_system
FROM (
  SELECT DISTINCT ON (webpage_activity.user_id) webpage_activity.user_id,
         substring(webpage_activity.activity FROM '_to=([a-z]+)$') AS choice
  FROM webpage_activity
  WHERE webpage_activity.activity LIKE 'Click\_module=ChangeUnits\_%'
  ORDER BY webpage_activity.user_id, webpage_activity.webpage_activity_id DESC
) AS latest_change
INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = latest_change.user_id
WHERE latest_change.choice IN ('metric', 'imperial')
ON CONFLICT (user_id) DO UPDATE SET measurement_system = EXCLUDED.measurement_system
WHERE user_settings.measurement_system IS NULL;

-- A NULL explore_tutorial_completed_at means the user hasn't finished or skipped the Explore tutorial anywhere yet.
CREATE TABLE IF NOT EXISTS sidewalk_login.user_account_state (
  user_id TEXT PRIMARY KEY REFERENCES sidewalk_login.sidewalk_user (user_id),
  explore_tutorial_completed_at TIMESTAMPTZ
);
ALTER TABLE sidewalk_login.user_account_state OWNER TO sidewalk;

-- Each city's run adds the users who finished the tutorial in that city, keeping the earliest time across cities.
-- Skipping it also marks the mission completed, and counts as done. The join leaves out missions from accounts that
-- no longer exist, which some cities have (#4589).
INSERT INTO sidewalk_login.user_account_state (user_id, explore_tutorial_completed_at)
SELECT mission.user_id, MIN(mission.mission_end)
FROM mission
INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = mission.user_id
WHERE mission.mission_type = 'auditOnboarding' AND mission.completed = TRUE
GROUP BY mission.user_id
ON CONFLICT (user_id) DO UPDATE
SET explore_tutorial_completed_at =
  LEAST(user_account_state.explore_tutorial_completed_at, EXCLUDED.explore_tutorial_completed_at);

# --- !Downs
-- Deliberately empty. Downs run once per city, so dropping the tables would break every city still running this
-- release, and the previous release never reads them. Nothing needs copying back either, since this release keeps
-- user_role.community_service current until #5306.
