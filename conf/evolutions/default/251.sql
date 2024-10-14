# --- !Ups

-- 1. audit_task (amt_assignment_id) references amt_assignment(amt_assignment_id)
ALTER TABLE audit_task
    ADD CONSTRAINT fk_audit_task_amt_assignment
        FOREIGN KEY (amt_assignment_id)
            REFERENCES amt_assignment(amt_assignment_id);

-- 2. audit_task_comment (user_id) references sidewalk_user(user_id)
ALTER TABLE audit_task_comment
    ADD CONSTRAINT fk_audit_task_comment_user
        FOREIGN KEY (user_id)
            REFERENCES sidewalk_user(user_id);

-- 3. audit_task_incomplete (audit_task_id) references audit_task(audit_task_id)
ALTER TABLE audit_task_incomplete
    ADD CONSTRAINT fk_audit_task_incomplete_audit_task
        FOREIGN KEY (audit_task_id)
            REFERENCES audit_task(audit_task_id);

-- 4. audit_task_interaction (audit_task_interaction_id) references audit_task_interaction_small(audit_task_interaction_id)
ALTER TABLE audit_task_interaction
    ADD CONSTRAINT fk_audit_task_interaction_small
        FOREIGN KEY (audit_task_interaction_id)
            REFERENCES audit_task_interaction_small(audit_task_interaction_id);

-- 5. audit_task_interaction (gsv_panorama_id) references gsv_data(gsv_panorama_id)
ALTER TABLE audit_task_interaction
    ADD CONSTRAINT fk_audit_task_interaction_gsv_data
        FOREIGN KEY (gsv_panorama_id)
            REFERENCES gsv_data(gsv_panorama_id);

-- 6. global_attribute (street_edge_id) references street_edge(street_edge_id)
ALTER TABLE global_attribute
    ADD CONSTRAINT fk_global_attribute_street_edge
        FOREIGN KEY (street_edge_id)
            REFERENCES street_edge(street_edge_id);

-- 7. gsv_data (gsv_panorama_id) references gsv_link(gsv_panorama_id)
ALTER TABLE gsv_data
    ADD CONSTRAINT fk_gsv_data_gsv_link
        FOREIGN KEY (gsv_panorama_id)
            REFERENCES gsv_link(gsv_panorama_id);

-- 8. label (gsv_panorama_id) references gsv_data(gsv_panorama_id)
ALTER TABLE label
    ADD CONSTRAINT fk_label_gsv_data
        FOREIGN KEY (gsv_panorama_id)
            REFERENCES gsv_data(gsv_panorama_id);

-- 9. label (street_edge_id) references street_edge(street_edge_id)
ALTER TABLE label
    ADD CONSTRAINT fk_label_street_edge
        FOREIGN KEY (street_edge_id)
            REFERENCES street_edge(street_edge_id);

-- 10. label (user_id) references sidewalk_user(user_id)
ALTER TABLE label
    ADD CONSTRAINT fk_label_user
        FOREIGN KEY (user_id)
            REFERENCES sidewalk_user(user_id);

-- 11. label_point (label_id) references label(label_id)
ALTER TABLE label_point
    ADD CONSTRAINT fk_label_point_label
        FOREIGN KEY (label_id)
            REFERENCES label(label_id);

-- 12. region_completion (region_id) references region(region_id)
ALTER TABLE region_completion
    ADD CONSTRAINT fk_region_completion_region
        FOREIGN KEY (region_id)
            REFERENCES region(region_id);

-- 13. street_edge_issue (street_edge_id) references street_edge(street_edge_id)
ALTER TABLE street_edge_issue
    ADD CONSTRAINT fk_street_edge_issue_street_edge
        FOREIGN KEY (street_edge_id)
            REFERENCES street_edge(street_edge_id);

-- 14. street_edge_issue (user_id) references sidewalk_user(user_id)
ALTER TABLE street_edge_issue
    ADD CONSTRAINT fk_street_edge_issue_user
        FOREIGN KEY (user_id)
            REFERENCES sidewalk_user(user_id);

-- 15. street_edge_region (region_id) references region(region_id)
ALTER TABLE street_edge_region
    ADD CONSTRAINT fk_street_edge_region_region
        FOREIGN KEY (region_id)
            REFERENCES region(region_id);

-- 16. street_edge_region (street_edge_id) references street_edge(street_edge_id)
ALTER TABLE street_edge_region
    ADD CONSTRAINT fk_street_edge_region_street_edge
        FOREIGN KEY (street_edge_id)
            REFERENCES street_edge(street_edge_id);

-- 17. user_current_region (region_id) references region(region_id)
ALTER TABLE user_current_region
    ADD CONSTRAINT fk_user_current_region_region
        FOREIGN KEY (region_id)
            REFERENCES region(region_id);

-- 18. user_current_region (user_id) references sidewalk_user(user_id)
ALTER TABLE user_current_region
    ADD CONSTRAINT fk_user_current_region_user
        FOREIGN KEY (user_id)
            REFERENCES sidewalk_user(user_id);

-- 19. user_login_info (login_info_id) references login_info(login_info_id)
ALTER TABLE user_login_info
    ADD CONSTRAINT fk_user_login_info_login_info
        FOREIGN KEY (login_info_id)
            REFERENCES login_info(login_info_id);

-- 20. user_password_info (login_info_id) references login_info(login_info_id)
ALTER TABLE user_password_info
    ADD CONSTRAINT fk_user_password_info_login_info
        FOREIGN KEY (login_info_id)
            REFERENCES login_info(login_info_id);

-- 21. user_role (role_id) references role(role_id)
ALTER TABLE user_role
    ADD CONSTRAINT fk_user_role_role
        FOREIGN KEY (role_id)
            REFERENCES role(role_id);

-- 22. user_role (user_id) references sidewalk_user(user_id)
ALTER TABLE user_role
    ADD CONSTRAINT fk_user_role_user
        FOREIGN KEY (user_id)
            REFERENCES sidewalk_user(user_id);

-- 23. user_survey_option_submission (survey_option_id) references survey_option(survey_option_id)
ALTER TABLE user_survey_option_submission
    ADD CONSTRAINT fk_user_survey_option_submission_survey_option
        FOREIGN KEY (survey_option_id)
            REFERENCES survey_option(survey_option_id);

-- 24. validation_task_interaction (gsv_panorama_id) references gsv_data(gsv_panorama_id)
ALTER TABLE validation_task_interaction
    ADD CONSTRAINT fk_validation_task_interaction_gsv_data
        FOREIGN KEY (gsv_panorama_id)
            REFERENCES gsv_data(gsv_panorama_id);

-- 25. validation_task_interaction (mission_id) references mission(mission_id)
ALTER TABLE validation_task_interaction
    ADD CONSTRAINT fk_validation_task_interaction_mission
        FOREIGN KEY (mission_id)
            REFERENCES mission(mission_id);

# --- !Downs

-- 1. Drop constraint from audit_task
ALTER TABLE audit_task
    DROP CONSTRAINT IF EXISTS fk_audit_task_amt_assignment;

-- 2. Drop constraint from audit_task_comment
ALTER TABLE audit_task_comment
    DROP CONSTRAINT IF EXISTS fk_audit_task_comment_user;

-- 3. Drop constraint from audit_task_incomplete
ALTER TABLE audit_task_incomplete
    DROP CONSTRAINT IF EXISTS fk_audit_task_incomplete_audit_task;

-- 4. Drop constraint from audit_task_interaction
ALTER TABLE audit_task_interaction
    DROP CONSTRAINT IF EXISTS fk_audit_task_interaction_small;

-- 5. Drop constraint from audit_task_interaction
ALTER TABLE audit_task_interaction
    DROP CONSTRAINT IF EXISTS fk_audit_task_interaction_gsv_data;

-- 6. Drop constraint from global_attribute
ALTER TABLE global_attribute
    DROP CONSTRAINT IF EXISTS fk_global_attribute_street_edge;

-- 7. Drop constraint from gsv_data
ALTER TABLE gsv_data
    DROP CONSTRAINT IF EXISTS fk_gsv_data_gsv_link;

-- 8. Drop constraint from label
ALTER TABLE label
    DROP CONSTRAINT IF EXISTS fk_label_gsv_data;

-- 9. Drop constraint from label
ALTER TABLE label
    DROP CONSTRAINT IF EXISTS fk_label_street_edge;

-- 10. Drop constraint from label
ALTER TABLE label
    DROP CONSTRAINT IF EXISTS fk_label_user;

-- 11. Drop constraint from label_point
ALTER TABLE label_point
    DROP CONSTRAINT IF EXISTS fk_label_point_label;

-- 12. Drop constraint from region_completion
ALTER TABLE region_completion
    DROP CONSTRAINT IF EXISTS fk_region_completion_region;

-- 13. Drop constraint from street_edge_issue
ALTER TABLE street_edge_issue
    DROP CONSTRAINT IF EXISTS fk_street_edge_issue_street_edge;

-- 14. Drop constraint from street_edge_issue
ALTER TABLE street_edge_issue
    DROP CONSTRAINT IF EXISTS fk_street_edge_issue_user;

-- 15. Drop constraint from street_edge_region
ALTER TABLE street_edge_region
    DROP CONSTRAINT IF EXISTS fk_street_edge_region_region;

-- 16. Drop constraint from street_edge_region
ALTER TABLE street_edge_region
    DROP CONSTRAINT IF EXISTS fk_street_edge_region_street_edge;

-- 17. Drop constraint from user_current_region
ALTER TABLE user_current_region
    DROP CONSTRAINT IF EXISTS fk_user_current_region_region;

-- 18. Drop constraint from user_current_region
ALTER TABLE user_current_region
    DROP CONSTRAINT IF EXISTS fk_user_current_region_user;

-- 19. Drop constraint from user_login_info
ALTER TABLE user_login_info
    DROP CONSTRAINT IF EXISTS fk_user_login_info_login_info;

-- 20. Drop constraint from user_password_info
ALTER TABLE user_password_info
    DROP CONSTRAINT IF EXISTS fk_user_password_info_login_info;

-- 21. Drop constraint from user_role
ALTER TABLE user_role
    DROP CONSTRAINT IF EXISTS fk_user_role_role;

-- 22. Drop constraint from user_role
ALTER TABLE user_role
    DROP CONSTRAINT IF EXISTS fk_user_role_user;

-- 23. Drop constraint from user_survey_option_submission
ALTER TABLE user_survey_option_submission
    DROP CONSTRAINT IF EXISTS fk_user_survey_option_submission_survey_option;

-- 24. Drop constraint from validation_task_interaction
ALTER TABLE validation_task_interaction
    DROP CONSTRAINT IF EXISTS fk_validation_task_interaction_gsv_data;

-- 25. Drop constraint from validation_task_interaction
ALTER TABLE validation_task_interaction
    DROP CONSTRAINT IF EXISTS fk_validation_task_interaction_mission;
