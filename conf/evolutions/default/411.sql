# --- !Ups
-- Visits from people with no session are logged with no user (#4643), so older ones come off the shared anonymous
-- account too. About 7 s for dev Seattle's 683k rows.
ALTER TABLE webpage_activity ALTER COLUMN user_id DROP NOT NULL;
UPDATE webpage_activity
SET user_id = NULL
WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = 'anonymous');

# --- !Downs
-- Older code can't read a row with no user. NOT NULL stays off, since putting it back locks the whole table.
UPDATE webpage_activity
SET user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = 'anonymous')
WHERE user_id IS NULL;
