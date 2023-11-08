# --- !Ups
DELETE FROM webpage_activity WHERE user_id IS NULL OR user_is NOT IN (SELECT user_id FROM sidewalk_user);

ALTER TABLE webpage_activity ADD CONSTRAINT fk_webpage_activity_user_id FOREIGN KEY (user_id) REFERENCES sidewalk_user (user_id);

# --- !Downs
ALTER TABLE webpage_activity DROP CONSTRAINT fk_webpage_activity_user_id;
