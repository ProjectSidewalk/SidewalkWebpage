# --- !Ups

ALTER TABLE audit_task
    ADD FOREIGN KEY (amt_assignment_id) REFERENCES amt_assignment(amt_assignment_id);

ALTER TABLE audit_task_comment
    ADD FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE audit_task_incomplete
    ADD FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id);

ALTER TABLE audit_task_interaction
    ADD FOREIGN KEY (audit_task_interaction_id) REFERENCES audit_task_interaction_small(audit_task_interaction_id);

ALTER TABLE audit_task_interaction
    ADD FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_data(gsv_panorama_id);

ALTER TABLE global_attribute
    ADD FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE gsv_data
    ADD FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_link(gsv_panorama_id);

ALTER TABLE label
    ADD FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_data(gsv_panorama_id);

ALTER TABLE label
    ADD FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE label
    ADD FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE label_point
    ADD FOREIGN KEY (label_id) REFERENCES label(label_id);

ALTER TABLE region_completion
    ADD FOREIGN KEY (region_id) REFERENCES region(region_id);

ALTER TABLE street_edge_issue
    ADD FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE street_edge_issue
    ADD FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE street_edge_region
    ADD FOREIGN KEY (region_id) REFERENCES region(region_id);

ALTER TABLE street_edge_region
    ADD FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE user_current_region
    ADD FOREIGN KEY (region_id) REFERENCES region(region_id);

ALTER TABLE user_current_region
    ADD FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE user_login_info
    ADD FOREIGN KEY (login_info_id) REFERENCES login_info(login_info_id);

ALTER TABLE user_password_info
    ADD FOREIGN KEY (login_info_id) REFERENCES login_info(login_info_id);

ALTER TABLE user_role
    ADD FOREIGN KEY (role_id) REFERENCES role(role_id);

ALTER TABLE user_role
    ADD FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE user_survey_option_submission
    ADD FOREIGN KEY (survey_option_id) REFERENCES survey_option(survey_option_id);

ALTER TABLE validation_task_interaction
    ADD FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_data(gsv_panorama_id);

ALTER TABLE validation_task_interaction
    ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

# --- !Downs

ALTER TABLE validation_task_interaction DROP CONSTRAINT IF EXISTS validation_task_interaction_mission_id_fkey;
ALTER TABLE validation_task_interaction DROP CONSTRAINT IF EXISTS validation_task_interaction_gsv_panorama_id_fkey;
ALTER TABLE user_survey_option_submission DROP CONSTRAINT IF EXISTS user_survey_option_submission_survey_option_id_fkey;
ALTER TABLE user_role DROP CONSTRAINT IF EXISTS user_role_user_id_fkey;
ALTER TABLE user_role DROP CONSTRAINT IF EXISTS user_role_role_id_fkey;
ALTER TABLE user_password_info DROP CONSTRAINT IF EXISTS user_password_info_login_info_id_fkey;
ALTER TABLE user_login_info DROP CONSTRAINT IF EXISTS user_login_info_login_info_id_fkey;
ALTER TABLE user_current_region DROP CONSTRAINT IF EXISTS user_current_region_user_id_fkey;
ALTER TABLE user_current_region DROP CONSTRAINT IF EXISTS user_current_region_region_id_fkey;
ALTER TABLE street_edge_region DROP CONSTRAINT IF EXISTS street_edge_region_street_edge_id_fkey;
ALTER TABLE street_edge_region DROP CONSTRAINT IF EXISTS street_edge_region_region_id_fkey;
ALTER TABLE street_edge_issue DROP CONSTRAINT IF EXISTS street_edge_issue_user_id_fkey;
ALTER TABLE street_edge_issue DROP CONSTRAINT IF EXISTS street_edge_issue_street_edge_id_fkey;
ALTER TABLE region_completion DROP CONSTRAINT IF EXISTS region_completion_region_id_fkey;
ALTER TABLE label_point DROP CONSTRAINT IF EXISTS label_point_label_id_fkey;
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_user_id_fkey;
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_street_edge_id_fkey;
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_gsv_panorama_id_fkey;
ALTER TABLE gsv_data DROP CONSTRAINT IF EXISTS gsv_data_gsv_panorama_id_fkey;
ALTER TABLE global_attribute DROP CONSTRAINT IF EXISTS global_attribute_street_edge_id_fkey;
ALTER TABLE audit_task_interaction DROP CONSTRAINT IF EXISTS audit_task_interaction_gsv_panorama_id_fkey;
ALTER TABLE audit_task_interaction DROP CONSTRAINT IF EXISTS audit_task_interaction_audit_task_interaction_id_fkey;
ALTER TABLE audit_task_incomplete DROP CONSTRAINT IF EXISTS audit_task_incomplete_audit_task_id_fkey;
ALTER TABLE audit_task_comment DROP CONSTRAINT IF EXISTS audit_task_comment_user_id_fkey;
ALTER TABLE audit_task DROP CONSTRAINT IF EXISTS audit_task_amt_assignment_id_fkey;
