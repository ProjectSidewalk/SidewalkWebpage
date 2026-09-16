# --- !Ups
-- Sign-in cookies issued before this time are rejected (#5305). Evolutions run once per city on this shared table.
ALTER TABLE sidewalk_login.user_account_state ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;

# --- !Downs
-- Deliberately empty. Downs run once per city, so dropping the column would break every city still on this release.
