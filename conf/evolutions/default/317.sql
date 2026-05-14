# --- !Ups
-- Fix user_team rows with user_team_id = 0 created by using Slick's insertOrUpdate in UserTeamTable.save(). Slick's
-- PostgresUpsertBuilder treated the literal 0 (the default for an Int auto-inc PK) as the upsert key, so once such a
-- row existed, every subsequent setUserTeam call silently overwrote it instead of inserting a new row. Reassign the bad
-- row to a fresh sequence id so the team membership is preserved. No-op for schemas with no such row.
SELECT setval('user_org_user_org_id_seq', GREATEST(COALESCE((SELECT MAX(user_team_id) FROM user_team), 0), 1));
UPDATE user_team SET user_team_id = nextval('user_org_user_org_id_seq') WHERE user_team_id = 0;

# --- !Downs
