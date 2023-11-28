# --- !Ups
DELETE FROM webpage_activity FROM webpage_activity LEFT JOIN sidewalk_user ON webpage_activity.user_id = sidewalk_user.user_id WHERE webpage_activity.user_id IS NULL OR sidewalk_user.user_id IS NULL;

ALTER TABLE webpage_activity ADD CONSTRAINT webpage_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_user (user_id);

# --- !Downs
ALTER TABLE webpage_activity DROP CONSTRAINT IF EXISTS webpage_activity_user_id_fkey;
