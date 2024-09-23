-- Add foreign key constraints from city schemas to login schema

# --- !Ups

-- Pittsburgh
ALTER TABLE sidewalk_pittsburgh.audit_task DROP CONSTRAINT IF EXISTS audit_task_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.audit_task ADD CONSTRAINT audit_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.gallery_task_environment DROP CONSTRAINT IF EXISTS gallery_task_environment_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.gallery_task_environment ADD CONSTRAINT gallery_task_environment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.gallery_task_interaction DROP CONSTRAINT IF EXISTS gallery_task_interaction_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.gallery_task_interaction ADD CONSTRAINT gallery_task_interaction_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.label_history DROP CONSTRAINT IF EXISTS label_history_edited_by_fkey;
ALTER TABLE sidewalk_pittsburgh.label_history ADD CONSTRAINT label_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.label_validation DROP CONSTRAINT IF EXISTS label_validation_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.label_validation ADD CONSTRAINT label_validation_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.mission DROP CONSTRAINT IF EXISTS mission_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.mission ADD CONSTRAINT mission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.route DROP CONSTRAINT IF EXISTS route_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.route ADD CONSTRAINT route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.user_clustering_session DROP CONSTRAINT IF EXISTS user_clustering_session_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.user_clustering_session ADD CONSTRAINT user_clustering_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.user_org DROP CONSTRAINT IF EXISTS user_org_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.user_org ADD CONSTRAINT user_org_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.user_route DROP CONSTRAINT IF EXISTS user_route_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.user_route ADD CONSTRAINT user_route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.user_stat DROP CONSTRAINT IF EXISTS user_stat_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.user_stat ADD CONSTRAINT user_stat_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.user_survey_option_submission DROP CONSTRAINT IF EXISTS user_survey_option_submission_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.user_survey_option_submission ADD CONSTRAINT user_survey_option_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.user_survey_text_submission DROP CONSTRAINT IF EXISTS user_survey_text_submission_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.user_survey_text_submission ADD CONSTRAINT user_survey_text_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.validation_task_comment DROP CONSTRAINT IF EXISTS validation_task_comment_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.validation_task_comment ADD CONSTRAINT validation_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_pittsburgh.webpage_activity DROP CONSTRAINT IF EXISTS webpage_activity_user_id_fkey;
ALTER TABLE sidewalk_pittsburgh.webpage_activity ADD CONSTRAINT webpage_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);

# --- !Downs
