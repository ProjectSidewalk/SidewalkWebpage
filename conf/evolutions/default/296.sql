# --- !Ups
-- Adds an index added to fix Validate performance issues.
CREATE INDEX label_ai_assessment_label_id_idx ON label_ai_assessment (label_id);

-- Add indexes on columns that are frequently used in joins/filters.
CREATE INDEX audit_task_user_id_idx ON audit_task (user_id);
CREATE INDEX audit_task_interaction_action_idx ON audit_task_interaction (action);
CREATE INDEX audit_task_interaction_small_action_idx ON audit_task_interaction_small (action);
CREATE INDEX audit_task_interaction_small_audit_task_id_idx ON audit_task_interaction_small (audit_task_id);
CREATE INDEX cluster_clustering_session_id_idx ON cluster (clustering_session_id);
CREATE INDEX cluster_label_type_id_idx ON cluster (label_type_id);
CREATE INDEX cluster_street_edge_id_idx ON cluster (street_edge_id);
CREATE INDEX cluster_label_cluster_id_idx ON cluster_label (cluster_id);
CREATE INDEX cluster_label_label_id_idx ON cluster_label (label_id);
CREATE INDEX clustering_session_region_id_idx ON clustering_session (region_id);
CREATE INDEX label_user_id_idx ON label (user_id);
CREATE INDEX label_street_edge_id_idx ON label (street_edge_id);
CREATE INDEX label_ai_assessment_label_validation_id_idx ON label_ai_assessment (label_validation_id);
CREATE INDEX label_ai_info_label_id_idx ON label_ai_info (label_id);
CREATE INDEX label_history_label_id_idx ON label_history (label_id);
CREATE INDEX label_history_label_validation_id_idx ON label_history (label_validation_id);
CREATE INDEX label_point_geom_idx ON label_point USING GIST (geom);
CREATE INDEX label_validation_label_id_idx ON label_validation (label_id);
CREATE INDEX label_validation_mission_id_idx ON label_validation (mission_id);
CREATE INDEX label_validation_user_id_idx ON label_validation (user_id);
CREATE INDEX label_validation_validation_result_idx ON label_validation (validation_result);
CREATE INDEX mission_label_type_id_idx ON mission (label_type_id);
CREATE INDEX mission_mission_type_id_idx ON mission (mission_type_id);
CREATE INDEX mission_region_id_idx ON mission (region_id);
CREATE INDEX osm_way_street_edge_street_edge_id_idx ON osm_way_street_edge (street_edge_id);
CREATE INDEX pano_history_location_curr_pano_id_idx ON pano_history (location_curr_pano_id);
CREATE INDEX street_edge_priority_street_edge_id_idx ON street_edge_priority (street_edge_id);
CREATE INDEX street_edge_priority_priority_idx ON street_edge_priority (priority);
CREATE INDEX user_stat_user_id_idx ON user_stat (user_id);
CREATE INDEX validation_task_interaction_action_idx ON validation_task_interaction (action);
CREATE INDEX validation_task_interaction_mission_id_idx ON validation_task_interaction (mission_id);

# --- !Downs
DROP INDEX validation_task_interaction_mission_id_idx;
DROP INDEX validation_task_interaction_action_idx;
DROP INDEX user_stat_user_id_idx;
DROP INDEX street_edge_priority_priority_idx;
DROP INDEX street_edge_priority_street_edge_id_idx;
DROP INDEX pano_history_location_curr_pano_id_idx;
DROP INDEX osm_way_street_edge_street_edge_id_idx;
DROP INDEX mission_region_id_idx;
DROP INDEX mission_mission_type_id_idx;
DROP INDEX mission_label_type_id_idx;
DROP INDEX label_validation_validation_result_idx;
DROP INDEX label_validation_user_id_idx;
DROP INDEX label_validation_mission_id_idx;
DROP INDEX label_validation_label_id_idx;
DROP INDEX label_point_geom_idx;
DROP INDEX label_history_label_validation_id_idx;
DROP INDEX label_history_label_id_idx;
DROP INDEX label_ai_info_label_id_idx;
DROP INDEX label_ai_assessment_label_validation_id_idx;
DROP INDEX label_street_edge_id_idx;
DROP INDEX label_user_id_idx;
DROP INDEX clustering_session_region_id_idx;
DROP INDEX cluster_label_label_id_idx;
DROP INDEX cluster_label_cluster_id_idx;
DROP INDEX cluster_street_edge_id_idx;
DROP INDEX cluster_label_type_id_idx;
DROP INDEX cluster_clustering_session_id_idx;
DROP INDEX audit_task_interaction_small_audit_task_id_idx;
DROP INDEX audit_task_interaction_small_action_idx;
DROP INDEX audit_task_interaction_action_idx;
DROP INDEX audit_task_user_id_idx;

DROP INDEX label_ai_assessment_label_id_idx;
