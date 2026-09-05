-- =====================================================================
-- Remove a set of label_validations from the DB.
--
-- Tables with a FK to label_validation:
--   label_edit              (label_validation_id nullable; the edit submitted with the validation, if it changed
--                            severity/tags; its label_history row hangs off label_edit.label_edit_id)
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
SELECT 'matching_label_edits',     COUNT(*) FROM label_edit
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
-- 4. Delete the edits these validations were submitted with and their label_history rows. Step 7 repairs the chains.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE edits_to_remove (label_edit_id INT PRIMARY KEY, label_id INT NOT NULL) ON COMMIT DROP;
INSERT INTO edits_to_remove (label_edit_id, label_id)
SELECT label_edit_id, label_id FROM label_edit
WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove);

DELETE FROM label_history
WHERE label_edit_id IN (SELECT label_edit_id FROM edits_to_remove);

DELETE FROM label_edit
WHERE label_edit_id IN (SELECT label_edit_id FROM edits_to_remove);

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
-- 7. Repair the affected labels' edit chains, as LabelEditService.revertEdit does for one undo: each surviving edit
--    starts from the label_history row before it, an edit that now changes nothing is removed with its history row,
--    and the label takes the state of its latest surviving history row.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE rebased_edits ON COMMIT DROP AS
SELECT label_edit.label_edit_id,
       ordered.prev_severity,
       ordered.prev_tags,
       (label_edit.new_severity IS NOT DISTINCT FROM ordered.prev_severity
        AND label_edit.new_tags <@ ordered.prev_tags AND ordered.prev_tags <@ label_edit.new_tags) AS noop
FROM (
    SELECT label_edit_id,
           LAG(severity) OVER per_label AS prev_severity,
           LAG(tags)     OVER per_label AS prev_tags
    FROM label_history
    WHERE label_id IN (SELECT label_id FROM edits_to_remove)
    WINDOW per_label AS (PARTITION BY label_id ORDER BY edit_time, label_history_id)
) AS ordered
INNER JOIN label_edit ON ordered.label_edit_id = label_edit.label_edit_id
WHERE label_edit.old_severity IS DISTINCT FROM ordered.prev_severity
    OR NOT (label_edit.old_tags <@ ordered.prev_tags AND ordered.prev_tags <@ label_edit.old_tags);

DELETE FROM label_history
WHERE label_edit_id IN (SELECT label_edit_id FROM rebased_edits WHERE noop);

DELETE FROM label_edit
WHERE label_edit_id IN (SELECT label_edit_id FROM rebased_edits WHERE noop);

UPDATE label_edit
SET old_severity = rebased_edits.prev_severity,
    old_tags     = rebased_edits.prev_tags
FROM rebased_edits
WHERE rebased_edits.label_edit_id = label_edit.label_edit_id AND NOT rebased_edits.noop;

UPDATE label
SET severity = latest.severity,
    tags     = latest.tags
FROM (
    SELECT DISTINCT ON (label_id) label_id, severity, tags
    FROM label_history
    WHERE label_id IN (SELECT label_id FROM edits_to_remove)
    ORDER BY label_id, edit_time DESC, label_history_id DESC
) AS latest
WHERE latest.label_id = label.label_id
    AND (label.severity IS DISTINCT FROM latest.severity
         OR NOT (label.tags <@ latest.tags AND latest.tags <@ label.tags));

-- ---------------------------------------------------------------------
-- 8. Refresh agree_count / disagree_count / unsure_count / correct across ALL labels.
--    Exclude self-validations and validations from excluded users.
-- ---------------------------------------------------------------------
UPDATE label
SET (agree_count, disagree_count, unsure_count, correct) = (n_agree, n_disagree, n_unsure, is_correct)
FROM (
    SELECT label.label_id,
           COUNT(CASE WHEN validation_result = 'Agree' AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_agree,
           COUNT(CASE WHEN validation_result = 'Disagree' AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_disagree,
           COUNT(CASE WHEN validation_result = 'Unsure' AND user_stat.user_id IS NOT NULL THEN 1 END) AS n_unsure,
           CASE
               WHEN COUNT(CASE WHEN validation_result = 'Agree' AND user_stat.user_id IS NOT NULL THEN 1 END)
                  > COUNT(CASE WHEN validation_result = 'Disagree' AND user_stat.user_id IS NOT NULL THEN 1 END) THEN TRUE
               WHEN COUNT(CASE WHEN validation_result = 'Disagree' AND user_stat.user_id IS NOT NULL THEN 1 END)
                  > COUNT(CASE WHEN validation_result = 'Agree' AND user_stat.user_id IS NOT NULL THEN 1 END) THEN FALSE
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
SELECT 'still_linked_in_label_edit',                   COUNT(*) FROM label_edit
    WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove)
UNION ALL
SELECT 'edits_without_history_row',                    COUNT(*) FROM label_edit
    LEFT JOIN label_history ON label_edit.label_edit_id = label_history.label_edit_id
    WHERE label_history.label_history_id IS NULL
UNION ALL
SELECT 'edits_with_broken_chain',                      COUNT(*)
    FROM (
        SELECT label_edit_id,
               LAG(severity) OVER per_label AS prev_severity,
               LAG(tags)     OVER per_label AS prev_tags
        FROM label_history
        WHERE label_id IN (SELECT label_id FROM edits_to_remove)
        WINDOW per_label AS (PARTITION BY label_id ORDER BY edit_time, label_history_id)
    ) AS ordered
    INNER JOIN label_edit ON ordered.label_edit_id = label_edit.label_edit_id
    WHERE label_edit.old_severity IS DISTINCT FROM ordered.prev_severity
        OR NOT (label_edit.old_tags <@ ordered.prev_tags AND ordered.prev_tags <@ label_edit.old_tags)
UNION ALL
SELECT 'still_linked_in_ai_assessment',               COUNT(*) FROM label_ai_assessment
    WHERE label_validation_id IN (SELECT label_validation_id FROM validations_to_remove);

-- If everything looks right:
COMMIT;
-- Otherwise:
-- ROLLBACK;
