# --- !Ups
-- When each account was created (#5532), so "how many users did we have on date X" no longer means digging through
-- every city's webpage_activity for SignUp rows. Accounts that already exist stay NULL until a one-off script fills
-- them in from those rows, which is too slow to do here. That is why the default is set in a second step: adding the
-- column with the default would stamp every existing account with today's date.
--
-- sidewalk_login is shared by every city and this runs once per city, so both statements are no-ops on runs 2..N.
ALTER TABLE sidewalk_login.sidewalk_user ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE sidewalk_login.sidewalk_user ALTER COLUMN created_at SET DEFAULT now();

# --- !Downs
ALTER TABLE sidewalk_login.sidewalk_user DROP COLUMN IF EXISTS created_at;
