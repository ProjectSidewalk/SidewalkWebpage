# --- !Ups
-- Drop the infra3d_access column now that city-specific columns were added in 313.sql.
ALTER TABLE sidewalk_login.user_role DROP COLUMN IF EXISTS infra3d_access;

# --- !Downs
ALTER TABLE sidewalk_login.user_role ADD COLUMN IF NOT EXISTS infra3d_access BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE sidewalk_login.user_role
SET infra3d_access = TRUE
WHERE zurich_infra3d_access = TRUE;
