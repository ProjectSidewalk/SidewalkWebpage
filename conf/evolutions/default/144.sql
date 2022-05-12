# --- !Ups
ALTER TABLE gallery_task_environment
    ADD COLUMN user_id TEXT,
    ADD CONSTRAINT gallery_task_environment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE gallery_task_interaction
    ADD COLUMN user_id TEXT,
    ADD CONSTRAINT gallery_task_interaction_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

# --- !Downs
ALTER TABLE gallery_task_interaction
    DROP CONSTRAINT IF EXISTS gallery_task_interaction_user_id_fkey,
    DROP COLUMN user_id;

ALTER TABLE gallery_task_environment
    DROP CONSTRAINT IF EXISTS gallery_task_environment_user_id_fkey,
    DROP COLUMN user_id;
