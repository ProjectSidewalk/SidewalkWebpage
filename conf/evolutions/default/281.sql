# --- !Ups
CREATE TABLE IF NOT EXISTS label_ai (
    label_ai_id SERIAL PRIMARY KEY,
    label_id INT NOT NULL,
    ai_tags TEXT[] DEFAULT '{}',
    ai_validation_result INT NOT NULL,
    ai_validation_accuracy DOUBLE PRECISION NOT NULL,
    api_version TEXT NOT NULL,
    time_created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (label_id) REFERENCES label (label_id)
);

INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 'SidewalkAI', 'sidewalkai@dummysitethatdoesnotexist.com'
WHERE NOT EXISTS (
    SELECT 1
    FROM sidewalk_login.sidewalk_user
    WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4'
);

INSERT INTO sidewalk_login.user_role (user_id, role_id)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 1
WHERE NOT EXISTS (
    SELECT 1
    FROM sidewalk_login.user_role
    WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4'
);

INSERT INTO user_stat (user_id, meters_audited, labels_per_meter, high_quality, high_quality_manual, own_labels_validated, accuracy, excluded)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 0.0, NULL, TRUE, NULL, 0, NULL, FALSE
WHERE NOT EXISTS (
    SELECT 1
    FROM user_stat
    WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4'
);

INSERT INTO user_current_region (user_id, region_id)
SELECT '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 0
WHERE NOT EXISTS (
    SELECT 1
    FROM user_current_region
    WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4'
);

# --- !Downs
DELETE FROM user_current_region WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM user_stat WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM sidewalk_login.user_role WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM label_validation WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';
DELETE FROM sidewalk_login.sidewalk_user WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

DROP TABLE IF EXISTS label_ai;
