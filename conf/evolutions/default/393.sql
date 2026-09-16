# --- !Ups
-- ?teams= on Expert Validate splits on commas and reads all-digit entries as ids, so names can be neither, and must be
-- unique ignoring case/outer spaces (#5342). The id is appended on a clash so a renamed team is never merged below.
WITH cleaned AS (
  SELECT team.team_id, btrim(regexp_replace(team.name, '[,[:space:]]+', ' ', 'g')) AS clean_name
  FROM team
  WHERE strpos(team.name, ',') > 0 OR btrim(team.name) ~ '^[0-9]+$'
), renamed AS (
  SELECT cleaned.team_id,
    CASE
      WHEN cleaned.clean_name = '' THEN 'Team ' || cleaned.team_id
      WHEN cleaned.clean_name ~ '^[0-9]+$' THEN 'Team ' || cleaned.clean_name
      ELSE cleaned.clean_name
    END AS new_name
  FROM cleaned
), counted AS (
  SELECT renamed.team_id, renamed.new_name, count(*) OVER (PARTITION BY lower(renamed.new_name)) AS same_name_count
  FROM renamed
), kept AS (
  SELECT lower(btrim(team.name)) AS name_key FROM team WHERE team.team_id NOT IN (SELECT cleaned.team_id FROM cleaned)
)
UPDATE team
SET name = CASE
  WHEN counted.same_name_count > 1 OR lower(counted.new_name) IN (SELECT kept.name_key FROM kept)
    THEN counted.new_name || ' (' || counted.team_id || ')'
  ELSE counted.new_name
END
FROM counted
WHERE team.team_id = counted.team_id;

-- Duplicate names were made by people who didn't spot the team already there, so each merges into its oldest.
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
ALTER TABLE team ADD CONSTRAINT team_name_no_comma_check CHECK (strpos(name, ',') = 0);
ALTER TABLE team ADD CONSTRAINT team_name_not_numeric_check CHECK (btrim(name) !~ '^[0-9]+$');

# --- !Downs
-- Renamed and merged teams are not restored.
ALTER TABLE team DROP CONSTRAINT IF EXISTS team_name_not_numeric_check;
ALTER TABLE team DROP CONSTRAINT IF EXISTS team_name_no_comma_check;
DROP INDEX IF EXISTS team_name_key;
