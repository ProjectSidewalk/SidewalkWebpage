# --- !Ups
-- When each account was created (#5532). Existing accounts get the moment this runs until
-- tools/one-off/5532-backfill-user-created-at.sql fills in their first visit, which is too slow to do here.
-- sidewalk_login is shared and this runs once per city, hence IF NOT EXISTS.
ALTER TABLE sidewalk_login.sidewalk_user ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Exact copies of the primary key's and the unique username key's own indexes, so they only slowed writes down.
DROP INDEX IF EXISTS sidewalk_login.user_id_idx;
DROP INDEX IF EXISTS sidewalk_login.username_idx;

# --- !Downs
CREATE INDEX IF NOT EXISTS username_idx ON sidewalk_login.sidewalk_user (username);
CREATE INDEX IF NOT EXISTS user_id_idx ON sidewalk_login.sidewalk_user (user_id);
ALTER TABLE sidewalk_login.sidewalk_user DROP COLUMN IF EXISTS created_at;
