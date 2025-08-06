# --- !Ups
-- Add new label_ai table.
CREATE TABLE IF NOT EXISTS label_ai (
    label_ai_id SERIAL PRIMARY KEY,
    label_id INT NOT NULL,
    validation_result INT NOT NULL,
    validation_accuracy DOUBLE PRECISION NOT NULL,
    validation_confidence DOUBLE PRECISION NOT NULL,
    tags TEXT[] DEFAULT '{}',
    tags_confidence jsonb,
    api_version TEXT NOT NULL,
    time_created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (label_id) REFERENCES label (label_id)
);

-- Add a dummy user for SidewalkAI so that we can create entries in label_validation on its behalf.
INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 'SidewalkAI', 'sidewalkai@dummysitethatdoesnotexist.com'
WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.sidewalk_user WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4');

INSERT INTO sidewalk_login.user_role (user_id, role_id)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 1
WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.user_role WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4');

INSERT INTO user_stat (user_id, meters_audited, labels_per_meter, high_quality, high_quality_manual, own_labels_validated, accuracy, excluded)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 0.0, NULL, TRUE, NULL, 0, NULL, FALSE
WHERE NOT EXISTS (SELECT 1 FROM user_stat WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4');

INSERT INTO user_current_region (user_id, region_id)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 0
WHERE NOT EXISTS (SELECT 1 FROM user_current_region WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4');

-- Add a new mission_type for AI validation.
-- While we're doing this, let's fix the skipped mission_type_id 6 by moving labelmapValidation from 7 to 6.
UPDATE mission_type SET mission_type = 'aiValidation' WHERE mission_type_id = 7;
INSERT INTO mission_type (mission_type_id, mission_type) SELECT 6, 'labelmapValidation';
UPDATE mission SET mission_type_id = 6 WHERE mission_type_id = 7;

-- Add missions to hold the AI validations, one for each label type. All AI validation will be attached to these.
INSERT INTO mission (mission_type_id, user_id, completed, paid, distance_meters, distance_progress, region_id,
                     labels_validated, labels_progress, skipped, label_type_id, current_audit_task_id)
VALUES (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 1, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 2, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 3, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 4, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 5, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 6, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 7, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 9, NULL),
       (7, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', FALSE, FALSE, NULL, NULL, NULL, 1, 0, FALSE, 10, NULL);

-- Fix validation_task_interaction logs that started with "TagAdd" instead of "Click=TagAdd"
UPDATE validation_task_interaction SET action = 'Click=' || action WHERE action LIKE 'TagAdd%';

# --- !Downs
-- Revert the interaction logs to their original state.
UPDATE validation_task_interaction SET action = REPLACE(action, 'Click=', '') WHERE action LIKE 'Click=TagAdd%';

-- Remove the validations created by AI validation.
DELETE FROM label_validation WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

-- Remove dummy missions created for AI validation and revert the labelmapValidation mission_type_id to 7.
DELETE FROM mission WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
UPDATE mission_type SET mission_type = 'labelmapValidation' WHERE mission_type_id = 7;
UPDATE mission SET mission_type_id = 7 WHERE mission_type_id = 6;
DELETE FROM mission_type WHERE mission_type_id = 6;

-- Remove the dummy user and all associated data.
DELETE FROM user_current_region WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM user_stat WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM sidewalk_login.user_role WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM label_validation WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM sidewalk_login.sidewalk_user WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

DROP TABLE IF EXISTS label_ai;
