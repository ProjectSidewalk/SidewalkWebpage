# --- !Ups
-- Add an official Unsure validations for all past AI validations where we didn't add one.
INSERT INTO label_validation (label_id, validation_result, user_id, mission_id, canvas_x, canvas_y, heading, pitch, zoom, canvas_width, canvas_height, start_timestamp, end_timestamp, source, old_severity, new_severity, old_tags, new_tags)
    SELECT label.label_id, 3, '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', mission.mission_id, label_point.canvas_x,
           label_point.canvas_y, label_point.heading, label_point.pitch, label_point.zoom, 720, 480,
           label_ai_assessment.timestamp, label_ai_assessment.timestamp, 'SidewalkAI', label.severity, label.severity,
           label.tags, label.tags
    FROM label_ai_assessment
    INNER JOIN label USING (label_id)
    INNER JOIN label_point ON label.label_id = label_point.label_id
    INNER JOIN mission ON label.label_type_id = mission.label_type_id
        AND mission.mission_type_id = 7
    LEFT JOIN label_validation ON label_ai_assessment.label_id = label_validation.label_id
    WHERE label_validation.label_validation_id IS NULL;

-- Link these validations back to the label_ai_assessment table. It's foreign key no longer needs to be nullable.
UPDATE label_ai_assessment
SET label_validation_id = (
    SELECT label_validation_id
    FROM label_validation
    WHERE label_ai_assessment.label_id = label_validation.label_id
    LIMIT 1
)
WHERE label_validation_id IS NULL;

ALTER TABLE label_ai_assessment ALTER COLUMN label_validation_id SET NOT NULL;

-- Recalculate validation counts now that we've added a bunch of validations.
UPDATE label
SET (agree_count, disagree_count, unsure_count, correct) = (n_agree, n_disagree, n_unsure, is_correct)
FROM (
    SELECT label.label_id,
           COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_agree,
           COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_disagree,
           COUNT(CASE WHEN validation_result = 3 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_unsure,
           CASE
               WHEN COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END)
                   > COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) THEN TRUE
               WHEN COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END)
                   > COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) THEN FALSE
               ELSE NULL
               END AS is_correct
    FROM label
        LEFT JOIN mission ON mission.mission_id = label.mission_id
        LEFT JOIN label_validation ON label.label_id = label_validation.label_id AND mission.user_id <> label_validation.user_id
        LEFT JOIN user_stat ON label_validation.user_id = user_stat.user_id AND user_stat.excluded = FALSE
    GROUP BY label.label_id
) AS validation_count
WHERE label.label_id = validation_count.label_id;


# --- !Downs
-- Remove the links to the Unsure validations that are in label_ai_assessment. The column needs to be nullable again.
ALTER TABLE label_ai_assessment ALTER COLUMN label_validation_id DROP NOT NULL;

UPDATE label_ai_assessment
SET label_validation_id = NULL
FROM label_validation
WHERE label_ai_assessment.label_validation_id = label_validation.label_validation_id
    AND label_validation.validation_result = 3;

-- Remove those validations.
DELETE FROM label_validation CASCADE WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4' AND validation_result = 3;

-- Recalculate validation counts now that we've removed a bunch of validations.
UPDATE label
SET (agree_count, disagree_count, unsure_count, correct) = (n_agree, n_disagree, n_unsure, is_correct)
FROM (
    SELECT label.label_id,
           COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_agree,
           COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_disagree,
           COUNT(CASE WHEN validation_result = 3 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_unsure,
           CASE
               WHEN COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END)
                   > COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) THEN TRUE
               WHEN COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END)
                   > COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) THEN FALSE
               ELSE NULL
               END AS is_correct
    FROM label
        LEFT JOIN mission ON mission.mission_id = label.mission_id
        LEFT JOIN label_validation ON label.label_id = label_validation.label_id AND mission.user_id <> label_validation.user_id
        LEFT JOIN user_stat ON label_validation.user_id = user_stat.user_id AND user_stat.excluded = FALSE
    GROUP BY label.label_id
) AS validation_count
WHERE label.label_id = validation_count.label_id;
