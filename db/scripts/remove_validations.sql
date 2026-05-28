-- =====================================================================
-- Remove a set of label_validations from the DB.
--
-- Tables with a FK to label_validation:
--   label_history           (label_validation_id nullable; only set when the validation changed severity/tags)
--   label_ai_assessment     (label_validation_id nullable)
--
-- Other tables touched by this script (no FK to label_validation, but logically tied):
--   validation_task_comment (label_id + user_id + mission_id match the validation)
--   label                   (agree_count / disagree_count / unsure_count / correct need a refresh)
--   user_stat               (own_labels_validated + accuracy derive from label.correct)
--   mission                 (labels_validated / labels_progress — NOT updated here; see note below)
--
-- NOT touched (intentionally):
--   mission.labels_validated / mission.labels_progress
--       These record what the validator accomplished during a past mission. Backing them out risks taking a completed
--       mission below the "completed" threshold and re-opening it.
--   validation_task_interaction / validation_task_environment
--       Keyed on mission_id only; the mission still exists so these are still valid.
--
-- Run inside a transaction so you can ROLLBACK if the preview looks wrong.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Candidate IDs. The default selection below targets validations users placed on their own labels
--    (allowed by a prior bug). Swap in one of the commented alternatives if you need a different scope.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE validations_to_remove (label_validation_id INT PRIMARY KEY) ON COMMIT DROP;

-- Default: validations placed by a user on their own label (self-validations).
INSERT INTO validations_to_remove (label_validation_id)
SELECT label_validation.label_validation_id
FROM label_validation
JOIN label ON label.label_id = label_validation.label_id
WHERE label.user_id = label_validation.user_id;

-- Option A: explicit list of IDs.
-- INSERT INTO validations_to_remove (label_validation_id) VALUES
--     (1), (2), (3);

-- Option B: all validations by a specific user (e.g. a banned/test account).
-- INSERT INTO validations_to_remove (label_validation_id)
-- SELECT label_validation_id FROM label_validation
-- WHERE user_id = '<user_id_here>';

-- ---------------------------------------------------------------------
-- 2. Preview. Sanity-check these counts before committing.
-- ---------------------------------------------------------------------
SELECT 'validations_to_remove'    AS bucket, COUNT(*) FROM validations_to_remove
UNION ALL
SELECT 'distinct_affected_labels', COUNT(DISTINCT lv.label_id) FROM label_validation lv
    JOIN validations_to_remove USING (label_validation_id)
UNION ALL
SELECT 'matching_label_history',   COUNT(*) FROM label_history
    WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove)
UNION ALL
SELECT 'matching_ai_assessments',  COUNT(*) FROM label_ai_assessment
    WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove)
UNION ALL
SELECT 'matching_comments',        COUNT(*) FROM validation_task_comment c
    WHERE EXISTS (
        SELECT 1 FROM label_validation lv
        JOIN validations_to_remove USING (label_validation_id)
        WHERE lv.label_id = c.label_id AND lv.user_id = c.user_id AND lv.mission_id = c.mission_id
    );

-- ---------------------------------------------------------------------
-- 3. Detach label_ai_assessment rows (we keep the assessment, just null out the link).
-- ---------------------------------------------------------------------
UPDATE label_ai_assessment
SET label_validation_id = NULL
WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove);

-- ---------------------------------------------------------------------
-- 4. Delete the matching label_history rows (the ones recorded by these validations).
-- ---------------------------------------------------------------------
DELETE FROM label_history
WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove);

-- ---------------------------------------------------------------------
-- 5. Delete the validation_task_comment rows tied to these validations (by label_id + user_id + mission_id).
-- ---------------------------------------------------------------------
DELETE FROM validation_task_comment c
USING label_validation lv
JOIN validations_to_remove USING (label_validation_id)
WHERE c.label_id = lv.label_id
    AND c.user_id = lv.user_id
    AND c.mission_id = lv.mission_id;

-- ---------------------------------------------------------------------
-- 6. Delete the validations themselves.
-- ---------------------------------------------------------------------
DELETE FROM label_validation
WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove);

-- ---------------------------------------------------------------------
-- 7. Clean up now-redundant label_history entries across ALL labels.
--    After removing validation-linked history rows, adjacent entries may have identical (severity, tags)
--    and no longer represent a change. Drop the later of any such pair.
-- ---------------------------------------------------------------------
DELETE FROM label_history
WHERE label_history_id IN (
    SELECT label_history_id
    FROM (
        SELECT label_history_id,
               severity,
               tags,
               LAG(severity) OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_severity,
               LAG(tags)     OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_tags
        FROM label_history
    ) subquery
    WHERE severity IS NOT DISTINCT FROM prev_severity
        AND tags     IS NOT DISTINCT FROM prev_tags
);

-- ---------------------------------------------------------------------
-- 8. Refresh agree_count / disagree_count / unsure_count / correct across ALL labels.
--    Exclude self-validations and validations from excluded users.
-- ---------------------------------------------------------------------
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
    LEFT JOIN label_validation ON label.label_id = label_validation.label_id
        AND mission.user_id <> label_validation.user_id
    LEFT JOIN user_stat ON label_validation.user_id = user_stat.user_id
        AND user_stat.excluded = FALSE
    GROUP BY label.label_id
) AS validation_count
WHERE label.label_id = validation_count.label_id AND (
    label.agree_count <> validation_count.n_agree
        OR label.disagree_count <> validation_count.n_disagree
        OR label.unsure_count <> validation_count.n_unsure
        OR label.correct <> validation_count.is_correct
);

-- ---------------------------------------------------------------------
-- 9. Refresh user_stat.own_labels_validated and user_stat.accuracy for all users.
--    Same formula as UserStatTable.updateAccuracy. Will be refreshed nightly, but may as well update now.
-- ---------------------------------------------------------------------
UPDATE user_stat
SET own_labels_validated = accuracy_subquery.new_validated_count,
    accuracy             = accuracy_subquery.new_accuracy
FROM (
    SELECT label.user_id,
           CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT)
               / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END)
                      + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0) AS new_accuracy,
           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS new_validated_count
    FROM label
    WHERE label.deleted = FALSE
        AND label.tutorial = FALSE
    GROUP BY label.user_id
) AS accuracy_subquery
WHERE user_stat.user_id = accuracy_subquery.user_id
    AND user_stat.own_labels_validated <> accuracy_subquery.new_validated_count;

-- Note: user_stat.high_quality is derived from accuracy + labels_per_meter and is recomputed by
-- UserStatTable.updateUserQuality on the next login / nightly job. Not touched here.

-- ---------------------------------------------------------------------
-- 10. Final check. Everything listed should now be 0.
-- ---------------------------------------------------------------------
SELECT 'still_in_label_validation'     AS where_found, COUNT(*) FROM label_validation
    WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove)
UNION ALL
SELECT 'still_linked_in_label_history',                COUNT(*) FROM label_history
    WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove)
UNION ALL
SELECT 'still_linked_in_ai_assessment',               COUNT(*) FROM label_ai_assessment
    WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove);

-- If everything looks right:
COMMIT;
-- Otherwise:
-- ROLLBACK;
