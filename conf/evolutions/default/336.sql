# --- !Ups
-- Add missing foreign key constraints (issue #3574). Every constraint here was verified orphan-free against the prod
-- dbs (after the user_current_region cleanup below), so the ADD CONSTRAINT runs on the spot should pass. Most FKs use
-- the default RESTRICT behavior. Four are safe to cascade on delete.

-- City-schema references.
ALTER TABLE label ADD CONSTRAINT label_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES street_edge (street_edge_id);
ALTER TABLE label_point ADD CONSTRAINT label_point_label_id_fkey FOREIGN KEY (label_id) REFERENCES label (label_id);
ALTER TABLE street_edge_issue ADD CONSTRAINT street_edge_issue_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES street_edge (street_edge_id);
ALTER TABLE street_edge_region ADD CONSTRAINT street_edge_region_region_id_fkey FOREIGN KEY (region_id) REFERENCES region (region_id);
ALTER TABLE user_survey_option_submission ADD CONSTRAINT user_survey_option_submission_survey_option_id_fkey FOREIGN KEY (survey_option_id) REFERENCES survey_option (survey_option_id);
ALTER TABLE audit_task ADD CONSTRAINT audit_task_amt_assignment_id_fkey FOREIGN KEY (amt_assignment_id) REFERENCES amt_assignment (amt_assignment_id);
-- edge_id is a street_edge reference despite the non-standard column name.
ALTER TABLE audit_task_comment ADD CONSTRAINT audit_task_comment_edge_id_fkey FOREIGN KEY (edge_id) REFERENCES street_edge (street_edge_id);
ALTER TABLE config ADD CONSTRAINT config_tutorial_street_edge_id_fkey FOREIGN KEY (tutorial_street_edge_id) REFERENCES street_edge (street_edge_id);
ALTER TABLE validation_task_interaction ADD CONSTRAINT validation_task_interaction_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES mission (mission_id);
ALTER TABLE validation_task_interaction ADD CONSTRAINT validation_task_interaction_pano_id_fkey FOREIGN KEY (pano_id) REFERENCES pano_data (pano_id);
ALTER TABLE pano_link ADD CONSTRAINT pano_link_pano_id_fkey FOREIGN KEY (pano_id) REFERENCES pano_data (pano_id);
ALTER TABLE gallery_task_interaction ADD CONSTRAINT gallery_task_interaction_pano_id_fkey FOREIGN KEY (pano_id) REFERENCES pano_data (pano_id);
ALTER TABLE validation_task_comment ADD CONSTRAINT validation_task_comment_pano_id_fkey FOREIGN KEY (pano_id) REFERENCES pano_data (pano_id);

-- City-schema references into the shared sidewalk_login schema.
ALTER TABLE label ADD CONSTRAINT label_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE street_edge_issue ADD CONSTRAINT street_edge_issue_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE audit_task_comment ADD CONSTRAINT audit_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE user_mistake_response ADD CONSTRAINT user_mistake_response_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
ALTER TABLE survey_question ADD CONSTRAINT survey_question_survey_user_role_id_fkey FOREIGN KEY (survey_user_role_id) REFERENCES sidewalk_login.role (role_id);

-- Remove orphaned user_current_region rows before adding the region_id FK below. 281.sql parks the SidewalkAI user at
-- the non-existent region_id 0, and that row (plus any other orphans) is safe to drop -- nothing requires a user's
-- current-region row to exist (reads return None, and /explore recreates it on the user's next visit), and the AI user
-- never explores.
DELETE FROM user_current_region WHERE region_id NOT IN (SELECT region_id FROM region);

-- Cascade-on-delete FKs (rationale in the header note).
ALTER TABLE region_completion ADD CONSTRAINT region_completion_region_id_fkey FOREIGN KEY (region_id) REFERENCES region (region_id) ON DELETE CASCADE;
ALTER TABLE street_edge_region ADD CONSTRAINT street_edge_region_street_edge_id_fkey FOREIGN KEY (street_edge_id) REFERENCES street_edge (street_edge_id) ON DELETE CASCADE;
ALTER TABLE user_current_region ADD CONSTRAINT user_current_region_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id) ON DELETE CASCADE;
ALTER TABLE user_current_region ADD CONSTRAINT user_current_region_region_id_fkey FOREIGN KEY (region_id) REFERENCES region (region_id) ON DELETE CASCADE;

-- Standardize three legacy FK constraint names to the <table>_<column>_fkey convention (metadata-only renames). They
-- predate the convention. `label_type_id` (evolution 30) was named after just the column. `fk_label_validation` (286)
-- used a one-off style. `user_org_org_id_fkey` is a leftover from the pre-263 user_org/org_id names -- 263 renamed the
-- table and column but Postgres does not rename a constraint along with them.
ALTER TABLE mission RENAME CONSTRAINT label_type_id TO mission_label_type_id_fkey;
ALTER TABLE label_ai_assessment RENAME CONSTRAINT fk_label_validation TO label_ai_assessment_label_validation_id_fkey;
ALTER TABLE user_team RENAME CONSTRAINT user_org_org_id_fkey TO user_team_team_id_fkey;

-- sidewalk_login FKs are intentionally NOT run by this evolution. The schema is shared, so an evolution touches it once
-- per city (~55x), and each ADD CONSTRAINT re-validates the whole (large) child table -- far too expensive to repeat
-- ~55 times. Run these ONCE by hand on the server instead:
--   ALTER TABLE sidewalk_login.user_role ADD CONSTRAINT user_role_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
--   ALTER TABLE sidewalk_login.user_role ADD CONSTRAINT user_role_role_id_fkey FOREIGN KEY (role_id) REFERENCES sidewalk_login.role (role_id);
--   ALTER TABLE sidewalk_login.user_login_info ADD CONSTRAINT user_login_info_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id);
--   ALTER TABLE sidewalk_login.user_login_info ADD CONSTRAINT user_login_info_login_info_id_fkey FOREIGN KEY (login_info_id) REFERENCES sidewalk_login.login_info (login_info_id);
--   ALTER TABLE sidewalk_login.user_password_info ADD CONSTRAINT user_password_info_login_info_id_fkey FOREIGN KEY (login_info_id) REFERENCES sidewalk_login.login_info (login_info_id);

# --- !Downs
-- City-schema references.
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_street_edge_id_fkey;
ALTER TABLE label_point DROP CONSTRAINT IF EXISTS label_point_label_id_fkey;
ALTER TABLE street_edge_issue DROP CONSTRAINT IF EXISTS street_edge_issue_street_edge_id_fkey;
ALTER TABLE street_edge_region DROP CONSTRAINT IF EXISTS street_edge_region_region_id_fkey;
ALTER TABLE user_survey_option_submission DROP CONSTRAINT IF EXISTS user_survey_option_submission_survey_option_id_fkey;
ALTER TABLE audit_task DROP CONSTRAINT IF EXISTS audit_task_amt_assignment_id_fkey;
ALTER TABLE audit_task_comment DROP CONSTRAINT IF EXISTS audit_task_comment_edge_id_fkey;
ALTER TABLE config DROP CONSTRAINT IF EXISTS config_tutorial_street_edge_id_fkey;
ALTER TABLE validation_task_interaction DROP CONSTRAINT IF EXISTS validation_task_interaction_mission_id_fkey;
ALTER TABLE validation_task_interaction DROP CONSTRAINT IF EXISTS validation_task_interaction_pano_id_fkey;
ALTER TABLE pano_link DROP CONSTRAINT IF EXISTS pano_link_pano_id_fkey;
ALTER TABLE gallery_task_interaction DROP CONSTRAINT IF EXISTS gallery_task_interaction_pano_id_fkey;
ALTER TABLE validation_task_comment DROP CONSTRAINT IF EXISTS validation_task_comment_pano_id_fkey;

-- City-schema references into sidewalk_login.
ALTER TABLE label DROP CONSTRAINT IF EXISTS label_user_id_fkey;
ALTER TABLE street_edge_issue DROP CONSTRAINT IF EXISTS street_edge_issue_user_id_fkey;
ALTER TABLE audit_task_comment DROP CONSTRAINT IF EXISTS audit_task_comment_user_id_fkey;
ALTER TABLE user_mistake_response DROP CONSTRAINT IF EXISTS user_mistake_response_user_id_fkey;
ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_user_id_fkey;
ALTER TABLE survey_question DROP CONSTRAINT IF EXISTS survey_question_survey_user_role_id_fkey;

-- Cascade-on-delete FKs.
ALTER TABLE region_completion DROP CONSTRAINT IF EXISTS region_completion_region_id_fkey;
ALTER TABLE street_edge_region DROP CONSTRAINT IF EXISTS street_edge_region_street_edge_id_fkey;
ALTER TABLE user_current_region DROP CONSTRAINT IF EXISTS user_current_region_user_id_fkey;
ALTER TABLE user_current_region DROP CONSTRAINT IF EXISTS user_current_region_region_id_fkey;

-- Revert the constraint-name standardizations.
ALTER TABLE mission RENAME CONSTRAINT mission_label_type_id_fkey TO label_type_id;
ALTER TABLE label_ai_assessment RENAME CONSTRAINT label_ai_assessment_label_validation_id_fkey TO fk_label_validation;
ALTER TABLE user_team RENAME CONSTRAINT user_team_team_id_fkey TO user_org_org_id_fkey;

-- sidewalk_login FKs were added by hand (see !Ups), so drop them by hand too when rolling back:
--   ALTER TABLE sidewalk_login.user_role DROP CONSTRAINT IF EXISTS user_role_user_id_fkey;
--   ALTER TABLE sidewalk_login.user_role DROP CONSTRAINT IF EXISTS user_role_role_id_fkey;
--   ALTER TABLE sidewalk_login.user_login_info DROP CONSTRAINT IF EXISTS user_login_info_user_id_fkey;
--   ALTER TABLE sidewalk_login.user_login_info DROP CONSTRAINT IF EXISTS user_login_info_login_info_id_fkey;
--   ALTER TABLE sidewalk_login.user_password_info DROP CONSTRAINT IF EXISTS user_password_info_login_info_id_fkey;
