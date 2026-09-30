# --- !Ups
-- Visits from people with no session are logged with no user (#4643). Moving old rows off the shared anonymous
-- account is too slow for startup, so tools/one-off/4643-null-anonymous-activity.sql does that after the deploy.
ALTER TABLE webpage_activity ALTER COLUMN user_id DROP NOT NULL;

# --- !Downs
UPDATE webpage_activity
SET user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = 'anonymous')
WHERE user_id IS NULL;
ALTER TABLE webpage_activity ALTER COLUMN user_id SET NOT NULL;
