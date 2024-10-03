-- Move data from city schemas to new login data schema.
-- TODO: Copy login data from ALL cities to login schema
-- TODO: Among duplicates across cities, keep data from most recently logged in user.
-- TODO: Update pkey sequence to the end of the data's sequence

# --- !Ups
-- Copy all login info from Seattle into the new sidewalk_login schema
INSERT INTO sidewalk_login.sidewalk_user(user_id, username, email)
SELECT user_id, username, email FROM sidewalk_seattle.sidewalk_user;

INSERT INTO sidewalk_login.login_info(login_info_id, provider_id, provider_key)
SELECT login_info_id, provider_id, provider_key FROM sidewalk_seattle.login_info;
SELECT setval('sidewalk_login.login_info_login_info_id_seq', (SELECT MAX(login_info_id) FROM sidewalk_login.login_info));

INSERT INTO sidewalk_login.user_login_info(user_login_info_id, user_id, login_info_id)
SELECT user_login_info_id, user_id, login_info_id FROM sidewalk_seattle.user_login_info;
SELECT setval('sidewalk_login.user_login_info_user_login_info_id_seq', (SELECT MAX(user_login_info_id) FROM sidewalk_login.user_login_info));

INSERT INTO sidewalk_login.user_password_info (user_password_info_id, login_info_id, "password", salt, hasher)
SELECT user_password_info_id, login_info_id, "password", salt, hasher FROM sidewalk_seattle.user_password_info;
SELECT setval('sidewalk_login.user_password_info_user_password_info_id_seq', (SELECT MAX(user_password_info_id) FROM sidewalk_login.user_password_info));

-- Move constraints over to the new schema.
ALTER TABLE sidewalk_seattle.audit_task DROP CONSTRAINT IF EXISTS audit_task_user_id_fkey;
ALTER TABLE sidewalk_seattle.audit_task ADD CONSTRAINT audit_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.gallery_task_environment DROP CONSTRAINT IF EXISTS gallery_task_environment_user_id_fkey;
ALTER TABLE sidewalk_seattle.gallery_task_environment ADD CONSTRAINT gallery_task_environment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.gallery_task_interaction DROP CONSTRAINT IF EXISTS gallery_task_interaction_user_id_fkey;
ALTER TABLE sidewalk_seattle.gallery_task_interaction ADD CONSTRAINT gallery_task_interaction_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.label_history DROP CONSTRAINT IF EXISTS label_history_edited_by_fkey;
ALTER TABLE sidewalk_seattle.label_history ADD CONSTRAINT label_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.label_validation DROP CONSTRAINT IF EXISTS label_validation_user_id_fkey;
ALTER TABLE sidewalk_seattle.label_validation ADD CONSTRAINT label_validation_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.mission DROP CONSTRAINT IF EXISTS mission_user_id_fkey;
ALTER TABLE sidewalk_seattle.mission ADD CONSTRAINT mission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.route DROP CONSTRAINT IF EXISTS route_user_id_fkey;
ALTER TABLE sidewalk_seattle.route ADD CONSTRAINT route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_clustering_session DROP CONSTRAINT IF EXISTS user_clustering_session_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_clustering_session ADD CONSTRAINT user_clustering_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_org DROP CONSTRAINT IF EXISTS user_org_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_org ADD CONSTRAINT user_org_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_route DROP CONSTRAINT IF EXISTS user_route_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_route ADD CONSTRAINT user_route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_stat DROP CONSTRAINT IF EXISTS user_stat_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_stat ADD CONSTRAINT user_stat_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_survey_option_submission DROP CONSTRAINT IF EXISTS user_survey_option_submission_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_survey_option_submission ADD CONSTRAINT user_survey_option_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_survey_text_submission DROP CONSTRAINT IF EXISTS user_survey_text_submission_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_survey_text_submission ADD CONSTRAINT user_survey_text_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.validation_task_comment DROP CONSTRAINT IF EXISTS validation_task_comment_user_id_fkey;
ALTER TABLE sidewalk_seattle.validation_task_comment ADD CONSTRAINT validation_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.webpage_activity DROP CONSTRAINT IF EXISTS webpage_activity_user_id_fkey;
ALTER TABLE sidewalk_seattle.webpage_activity ADD CONSTRAINT webpage_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);

TRUNCATE sidewalk_seattle.auth_tokens;
TRUNCATE sidewalk_seattle.sidewalk_user;
TRUNCATE sidewalk_seattle.login_info;
TRUNCATE sidewalk_seattle.user_login_info;
TRUNCATE sidewalk_seattle.user_password_info;

# --- !Downs
-- Copy all login info from sidewalk_login back into the Seattle schema.
INSERT INTO sidewalk_seattle.sidewalk_user(user_id, username, email)
SELECT user_id, username, email FROM sidewalk_login.sidewalk_user;

INSERT INTO sidewalk_seattle.login_info(login_info_id, provider_id, provider_key)
SELECT login_info_id, provider_id, provider_key FROM sidewalk_login.login_info;
SELECT setval('sidewalk_seattle.logininfo_id_seq', (SELECT MAX(login_info_id) FROM sidewalk_seattle.login_info));

INSERT INTO sidewalk_seattle.user_login_info(user_login_info_id, user_id, login_info_id)
SELECT user_login_info_id, user_id, login_info_id FROM sidewalk_login.user_login_info;
-- SELECT setval('sidewalk_seattle.user_login_info_user_login_info_id_seq', (SELECT MAX(user_login_info_id) FROM sidewalk_seattle.user_login_info));

INSERT INTO sidewalk_seattle.user_password_info (user_password_info_id, login_info_id, "password", salt, hasher)
SELECT user_password_info_id, login_info_id, "password", salt, hasher FROM sidewalk_login.user_password_info;
-- SELECT setval('sidewalk_seattle.user_password_info_user_password_info_id_seq', (SELECT MAX(user_password_info_id) FROM sidewalk_seattle.user_password_info));

-- Move the constraints back to the Seattle schema.
ALTER TABLE sidewalk_seattle.webpage_activity DROP CONSTRAINT IF EXISTS webpage_activity_user_id_fkey;
ALTER TABLE sidewalk_seattle.webpage_activity ADD CONSTRAINT webpage_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.validation_task_comment DROP CONSTRAINT IF EXISTS validation_task_comment_user_id_fkey;
ALTER TABLE sidewalk_seattle.validation_task_comment ADD CONSTRAINT validation_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_survey_text_submission DROP CONSTRAINT IF EXISTS user_survey_text_submission_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_survey_text_submission ADD CONSTRAINT user_survey_text_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_survey_option_submission DROP CONSTRAINT IF EXISTS user_survey_option_submission_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_survey_option_submission ADD CONSTRAINT user_survey_option_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_stat DROP CONSTRAINT IF EXISTS user_stat_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_stat ADD CONSTRAINT user_stat_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_route DROP CONSTRAINT IF EXISTS user_route_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_route ADD CONSTRAINT user_route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_org DROP CONSTRAINT IF EXISTS user_org_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_org ADD CONSTRAINT user_org_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.user_clustering_session DROP CONSTRAINT IF EXISTS user_clustering_session_user_id_fkey;
ALTER TABLE sidewalk_seattle.user_clustering_session ADD CONSTRAINT user_clustering_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.route DROP CONSTRAINT IF EXISTS route_user_id_fkey;
ALTER TABLE sidewalk_seattle.route ADD CONSTRAINT route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.mission DROP CONSTRAINT IF EXISTS mission_user_id_fkey;
ALTER TABLE sidewalk_seattle.mission ADD CONSTRAINT mission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.label_validation DROP CONSTRAINT IF EXISTS label_validation_user_id_fkey;
ALTER TABLE sidewalk_seattle.label_validation ADD CONSTRAINT label_validation_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.label_history DROP CONSTRAINT IF EXISTS label_history_edited_by_fkey;
ALTER TABLE sidewalk_seattle.label_history ADD CONSTRAINT label_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.gallery_task_interaction DROP CONSTRAINT IF EXISTS gallery_task_interaction_user_id_fkey;
ALTER TABLE sidewalk_seattle.gallery_task_interaction ADD CONSTRAINT gallery_task_interaction_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.gallery_task_environment DROP CONSTRAINT IF EXISTS gallery_task_environment_user_id_fkey;
ALTER TABLE sidewalk_seattle.gallery_task_environment ADD CONSTRAINT gallery_task_environment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);
ALTER TABLE sidewalk_seattle.audit_task DROP CONSTRAINT IF EXISTS audit_task_user_id_fkey;
ALTER TABLE sidewalk_seattle.audit_task ADD CONSTRAINT audit_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_seattle.sidewalk_user(user_id);

-- Truncate the tables in the sidewalk_login schema.
TRUNCATE sidewalk_login.user_password_info;
TRUNCATE sidewalk_login.user_login_info;
TRUNCATE sidewalk_login.login_info;
TRUNCATE sidewalk_login.sidewalk_user;
TRUNCATE sidewalk_login.auth_tokens;
