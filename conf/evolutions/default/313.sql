# --- !Ups
-- Replace the global sidewalk_login.user_role.infra3d_access flag with one column per infra3d-capable city, so access
-- can be granted per city. Zurich inherits the existing grants from the legacy column. Winterthur starts fresh. The
-- legacy column is intentionally left in place to be dropped by a follow-up evolution once every deployment has run
-- this one -- otherwise a non-infra3d city running first would drop it before the backfill below could read it.
ALTER TABLE sidewalk_login.user_role ADD COLUMN IF NOT EXISTS zurich_infra3d_access BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sidewalk_login.user_role ADD COLUMN IF NOT EXISTS winterthur_infra3d_access BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE sidewalk_login.user_role
SET zurich_infra3d_access = TRUE
WHERE infra3d_access = TRUE;

# --- !Downs
ALTER TABLE sidewalk_login.user_role DROP COLUMN IF EXISTS winterthur_infra3d_access;
ALTER TABLE sidewalk_login.user_role DROP COLUMN IF EXISTS zurich_infra3d_access;
