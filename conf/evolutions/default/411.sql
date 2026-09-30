# --- !Ups
-- Visits from people with no session are logged with no user (#4643). Moving old rows off the shared anonymous
-- account is too slow for startup, so tools/one-off/4643-null-anonymous-activity.sql does that after the deploy.
ALTER TABLE webpage_activity ALTER COLUMN user_id DROP NOT NULL;

# --- !Downs
-- Older code can't read a row with no user, so give those rows back to the anonymous account. NOT NULL stays off,
-- since restoring it scans and locks the whole table and older code never writes an empty user anyway.
UPDATE webpage_activity
SET user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = 'anonymous')
WHERE user_id IS NULL;
