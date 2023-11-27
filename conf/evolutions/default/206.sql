# --- !Ups
DELETE FROM webpage_activity WHERE user_id IS NULL OR user_id NOT IN (SELECT user_id FROM sidewalk_user);

ALTER TABLE webpage_activity ADD CONSTRAINT webpage_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_user (user_id);

# --- !Downs
ALTER TABLE webpage_activity DROP CONSTRAINT webpage_activity_user_id_fkey;
