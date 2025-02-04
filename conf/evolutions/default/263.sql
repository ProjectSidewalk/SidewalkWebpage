# --- !Ups
ALTER TABLE organization RENAME TO team;
ALTER TABLE team RENAME COLUMN org_id TO team_id;
ALTER TABLE team RENAME COLUMN org_name TO name;
ALTER TABLE team RENAME COLUMN org_description TO description;
ALTER TABLE team RENAME COLUMN is_open TO open;
ALTER TABLE team RENAME COLUMN is_visible TO visible;

ALTER TABLE user_org RENAME TO user_team;
ALTER TABLE user_team RENAME COLUMN user_org_id TO user_team_id;
ALTER TABLE user_team RENAME COLUMN org_id TO team_id;

# --- !Downs
ALTER TABLE user_team RENAME COLUMN team_id TO org_id;
ALTER TABLE user_team RENAME COLUMN user_team_id TO user_org_id;
ALTER TABLE user_team RENAME TO user_org;

ALTER TABLE team RENAME COLUMN visible TO is_visible;
ALTER TABLE team RENAME COLUMN open TO is_open;
ALTER TABLE team RENAME COLUMN description TO org_description;
ALTER TABLE team RENAME COLUMN name TO org_name;
ALTER TABLE team RENAME COLUMN team_id TO org_id;
ALTER TABLE team RENAME TO organization;
