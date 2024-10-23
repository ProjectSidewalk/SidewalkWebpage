# --- !Ups

ALTER TABLE audit_task
    ADD CONSTRAINT fk_audit_task_amt_assignment
        FOREIGN KEY (amt_assignment_id) REFERENCES amt_assignment(amt_assignment_id);

ALTER TABLE audit_task_comment
    ADD CONSTRAINT fk_audit_task_comment_user
        FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE audit_task_incomplete
    ADD CONSTRAINT fk_audit_task_incomplete_audit_task
        FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id);

ALTER TABLE audit_task_interaction
    ADD CONSTRAINT fk_audit_task_interaction_small
        FOREIGN KEY (audit_task_interaction_id) REFERENCES audit_task_interaction_small(audit_task_interaction_id);

ALTER TABLE audit_task_interaction
    ADD CONSTRAINT fk_audit_task_interaction_gsv_data
        FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_data(gsv_panorama_id);

ALTER TABLE global_attribute
    ADD CONSTRAINT fk_global_attribute_street_edge
        FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE gsv_data
    ADD CONSTRAINT fk_gsv_data_gsv_link
        FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_link(gsv_panorama_id);

ALTER TABLE label
    ADD CONSTRAINT fk_label_gsv_data
        FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_data(gsv_panorama_id);

ALTER TABLE label
    ADD CONSTRAINT fk_label_street_edge
        FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE label
    ADD CONSTRAINT fk_label_user
        FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE label_point
    ADD CONSTRAINT fk_label_point_label
        FOREIGN KEY (label_id) REFERENCES label(label_id);

ALTER TABLE region_completion
    ADD CONSTRAINT fk_region_completion_region
        FOREIGN KEY (region_id) REFERENCES region(region_id);

ALTER TABLE street_edge_issue
    ADD CONSTRAINT fk_street_edge_issue_street_edge
        FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE street_edge_issue
    ADD CONSTRAINT fk_street_edge_issue_user
        FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE street_edge_region
    ADD CONSTRAINT fk_street_edge_region_region
        FOREIGN KEY (region_id) REFERENCES region(region_id);

ALTER TABLE street_edge_region
    ADD CONSTRAINT fk_street_edge_region_street_edge
        FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id);

ALTER TABLE user_current_region
    ADD CONSTRAINT fk_user_current_region_region
        FOREIGN KEY (region_id) REFERENCES region(region_id);

ALTER TABLE user_current_region
    ADD CONSTRAINT fk_user_current_region_user
        FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE user_login_info
    ADD CONSTRAINT fk_user_login_info_login_info
        FOREIGN KEY (login_info_id) REFERENCES login_info(login_info_id);

ALTER TABLE user_password_info
    ADD CONSTRAINT fk_user_password_info_login_info
        FOREIGN KEY (login_info_id) REFERENCES login_info(login_info_id);

ALTER TABLE user_role
    ADD CONSTRAINT fk_user_role_role
        FOREIGN KEY (role_id) REFERENCES role(role_id);

ALTER TABLE user_role
    ADD CONSTRAINT fk_user_role_user
        FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id);

ALTER TABLE user_survey_option_submission
    ADD CONSTRAINT fk_user_survey_option_submission_survey_option
        FOREIGN KEY (survey_option_id) REFERENCES survey_option(survey_option_id);

ALTER TABLE validation_task_interaction
    ADD CONSTRAINT fk_validation_task_interaction_gsv_data
        FOREIGN KEY (gsv_panorama_id) REFERENCES gsv_data(gsv_panorama_id);

ALTER TABLE validation_task_interaction
    ADD CONSTRAINT fk_validation_task_interaction_mission
        FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

# --- !Downs

DROP CONSTRAINT IF EXISTS fk_validation_task_interaction_mission;
DROP CONSTRAINT IF EXISTS fk_validation_task_interaction_gsv_data;
DROP CONSTRAINT IF EXISTS fk_user_survey_option_submission_survey_option;
DROP CONSTRAINT IF EXISTS fk_user_role_user;
DROP CONSTRAINT IF EXISTS fk_user_role_role;
DROP CONSTRAINT IF EXISTS fk_user_password_info_login_info;
DROP CONSTRAINT IF EXISTS fk_user_login_info_login_info;
DROP CONSTRAINT IF EXISTS fk_user_current_region_user;
DROP CONSTRAINT IF EXISTS fk_user_current_region_region;
DROP CONSTRAINT IF EXISTS fk_street_edge_region_street_edge;
DROP CONSTRAINT IF EXISTS fk_street_edge_region_region;
DROP CONSTRAINT IF EXISTS fk_street_edge_issue_user;
DROP CONSTRAINT IF EXISTS fk_street_edge_issue_street_edge;
DROP CONSTRAINT IF EXISTS fk_region_completion_region;
DROP CONSTRAINT IF EXISTS fk_label_point_label;
DROP CONSTRAINT IF EXISTS fk_label_user;
DROP CONSTRAINT IF EXISTS fk_label_street_edge;
DROP CONSTRAINT IF EXISTS fk_label_gsv_data;
DROP CONSTRAINT IF EXISTS fk_gsv_data_gsv_link;
DROP CONSTRAINT IF EXISTS fk_global_attribute_street_edge;
DROP CONSTRAINT IF EXISTS fk_audit_task_interaction_gsv_data;
DROP CONSTRAINT IF EXISTS fk_audit_task_interaction_small;
DROP CONSTRAINT IF EXISTS fk_audit_task_incomplete_audit_task;
DROP CONSTRAINT IF EXISTS fk_audit_task_comment_user;
DROP CONSTRAINT IF EXISTS fk_audit_task_amt_assignment;
