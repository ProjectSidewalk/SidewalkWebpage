# --- !Ups
UPDATE user_stat SET exclude_manual = FALSE WHERE exclude_manual IS NULL;
ALTER TABLE user_stat ALTER COLUMN exclude_manual SET NOT NULL;

UPDATE label
SET (agree_count, disagree_count, notsure_count, correct) = (n_agree, n_disagree, n_notsure, is_correct)
FROM (
    SELECT label.label_id,
           COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_agree,
           COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_disagree,
           COUNT(CASE WHEN validation_result = 3 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_notsure,
           CASE
               WHEN COUNT(CASE WHEN validation_result = 1 THEN 1 END) > COUNT(CASE WHEN validation_result = 2 THEN 1 END) THEN TRUE
               WHEN COUNT(CASE WHEN validation_result = 2 THEN 1 END) > COUNT(CASE WHEN validation_result = 1 THEN 1 END) THEN FALSE
               ELSE NULL
               END AS is_correct
    FROM label
    LEFT JOIN mission ON mission.mission_id = label.mission_id
    LEFT JOIN label_validation ON label.label_id = label_validation.label_id AND mission.user_id <> label_validation.user_id
    LEFT JOIN user_stat ON label_validation.user_id = user_stat.user_id AND user_stat.exclude_manual = FALSE
    GROUP BY label.label_id
) AS validation_count
    INNER JOIN label_validation ON validation_count.label_id = label_validation.label_id
    INNER JOIN user_stat ON label_validation.user_id = user_stat.user_id
WHERE label.label_id = validation_count.label_id
    AND user_stat.exclude_manual = TRUE;

ALTER TABLE user_stat RENAME COLUMN exclude_manual TO excluded;

# --- !Downs
ALTER TABLE user_stat RENAME COLUMN excluded TO exclude_manual;

UPDATE label
SET (agree_count, disagree_count, notsure_count, correct) = (n_agree, n_disagree, n_notsure, is_correct)
FROM (
    SELECT label.label_id,
           COUNT(CASE WHEN validation_result = 1 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_agree,
           COUNT(CASE WHEN validation_result = 2 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_disagree,
           COUNT(CASE WHEN validation_result = 3 AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_notsure,
           CASE
               WHEN COUNT(CASE WHEN validation_result = 1 THEN 1 END) > COUNT(CASE WHEN validation_result = 2 THEN 1 END) THEN TRUE
               WHEN COUNT(CASE WHEN validation_result = 2 THEN 1 END) > COUNT(CASE WHEN validation_result = 1 THEN 1 END) THEN FALSE
               ELSE NULL
               END AS is_correct
    FROM label
    LEFT JOIN mission ON mission.mission_id = label.mission_id
    LEFT JOIN label_validation ON label.label_id = label_validation.label_id AND mission.user_id <> label_validation.user_id
    LEFT JOIN user_stat ON label_validation.user_id = user_stat.user_id
    GROUP BY label.label_id
) AS validation_count
    INNER JOIN label_validation ON validation_count.label_id = label_validation.label_id
    INNER JOIN user_stat ON label_validation.user_id = user_stat.user_id
WHERE label.label_id = validation_count.label_id
    AND user_stat.exclude_manual = TRUE;

ALTER TABLE user_stat ALTER COLUMN exclude_manual DROP NOT NULL;
UPDATE user_stat SET exclude_manual = NULL WHERE exclude_manual = FALSE;
