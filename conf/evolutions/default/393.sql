# --- !Ups
-- Team names become unique ignoring case/outer spaces (#5342) -- existing duplicates merge into the oldest first.
WITH keeper AS (
  SELECT lower(btrim(team.name)) AS name_key, min(team.team_id) AS team_id FROM team GROUP BY lower(btrim(team.name))
)
UPDATE user_team SET team_id = keeper.team_id
FROM team, keeper
WHERE user_team.team_id = team.team_id
  AND lower(btrim(team.name)) = keeper.name_key
  AND team.team_id <> keeper.team_id;

WITH keeper AS (
  SELECT lower(btrim(team.name)) AS name_key, min(team.team_id) AS team_id FROM team GROUP BY lower(btrim(team.name))
)
DELETE FROM team USING keeper WHERE lower(btrim(team.name)) = keeper.name_key AND team.team_id <> keeper.team_id;

CREATE UNIQUE INDEX team_name_key ON team (lower(btrim(name)));

-- ?teams= is comma-separated and reads an all-digit entry as a team id, so names can be neither.
ALTER TABLE team ADD CONSTRAINT team_name_no_comma_check CHECK (strpos(name, ',') = 0);
ALTER TABLE team ADD CONSTRAINT team_name_not_numeric_check CHECK (btrim(name) !~ '^[0-9]+$');

# --- !Downs
-- The merged teams are not restored.
ALTER TABLE team DROP CONSTRAINT IF EXISTS team_name_not_numeric_check;
ALTER TABLE team DROP CONSTRAINT IF EXISTS team_name_no_comma_check;
DROP INDEX IF EXISTS team_name_key;
