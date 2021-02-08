# --- !Ups
DELETE FROM label_validation
USING mission, mission_type
WHERE label_validation.mission_id = mission.mission_id
    AND mission.mission_type_id = mission_type.mission_type_id
    AND mission_type.mission_type = 'rapidValidation';

DELETE FROM validation_task_environment
USING mission, mission_type
WHERE validation_task_environment.mission_id = mission.mission_id
  AND mission.mission_type_id = mission_type.mission_type_id
  AND mission_type.mission_type = 'rapidValidation';

DELETE FROM validation_task_interaction
    USING mission, mission_type
WHERE validation_task_interaction.mission_id = mission.mission_id
  AND mission.mission_type_id = mission_type.mission_type_id
  AND mission_type.mission_type = 'rapidValidation';

DELETE FROM validation_task_comment
    USING mission, mission_type
WHERE validation_task_comment.mission_id = mission.mission_id
  AND mission.mission_type_id = mission_type.mission_type_id
  AND mission_type.mission_type = 'rapidValidation';

DELETE FROM mission
USING mission_type
WHERE mission.mission_type_id = mission_type.mission_type_id
    AND mission_type.mission_type = 'rapidValidation';

DELETE FROM mission_type WHERE mission_type = 'rapidValidation';

# --- !Downs
INSERT INTO mission_type (mission_type_id, mission_type) VALUES (6, 'rapidValidation' );
