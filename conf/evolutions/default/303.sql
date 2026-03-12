# --- !Ups
ALTER TABLE sidewalk_login.user_role ADD COLUMN IF NOT EXISTS infra3d_access BOOLEAN NOT NULL DEFAULT FALSE;

# --- !Downs
ALTER TABLE sidewalk_login.user_role DROP COLUMN IF EXISTS infra3d_access;
