-- #5920 undo: restore every label 5920-dc-linear-projection.sql touched from the backup table it keeps, and the
-- votes it archived (355's Downs, scoped to those labels). ONE schema (sidewalk_dc), a write role. The centerline
-- offsets it recomputed for the rows #5667 had moved stay: they are the correct values for those positions.
--
--   psql "dbname=sidewalk options=--search_path=sidewalk_dc,public" -U sidewalk_dc -v ON_ERROR_STOP=1 \
--     -f tools/one-off/5920-undo-dc-linear-projection.sql
BEGIN;
-- label.street_edge_id is insert-only in the app, so restoring the backed-up value cannot overwrite anything that
-- happened in between. The inequality only skips no-op rows.
UPDATE label
SET street_edge_id = old_label_point_linear.street_edge_id
FROM old_label_point_linear
WHERE label.label_id = old_label_point_linear.label_id
  AND label.street_edge_id <> old_label_point_linear.street_edge_id;

UPDATE label_point
SET heading = old_label_point_linear.heading,
    pitch = old_label_point_linear.pitch,
    pano_x = old_label_point_linear.pano_x,
    pano_y = old_label_point_linear.pano_y,
    lat = old_label_point_linear.lat,
    lng = old_label_point_linear.lng,
    geom = old_label_point_linear.geom,
    computation_method = old_label_point_linear.computation_method::computation_method,
    centerline_offset_m = old_label_point_linear.centerline_offset_m
FROM old_label_point_linear
WHERE label_point.label_point_id = old_label_point_linear.label_point_id;

-- 355's Downs: no ON CONFLICT, so a validator's newer vote on the same label fails the restore loudly and a human
-- picks the survivor. The archive predates votes carrying a type, so a vote takes the label's current one, and an
-- edit it carried gets a fresh label_edit row under its history row's original id.
CREATE TEMP TABLE restored (label_validation_id INT PRIMARY KEY, label_id INT NOT NULL) ON COMMIT DROP;
INSERT INTO restored
SELECT voided_label_validation.label_validation_id, voided_label_validation.label_id FROM voided_label_validation
WHERE EXISTS (SELECT 1 FROM old_label_point_linear
              WHERE old_label_point_linear.label_id = voided_label_validation.label_id);

INSERT INTO label_validation (label_validation_id, label_id, validation_result, user_id, mission_id, canvas_x,
                              canvas_y, heading, pitch, zoom, canvas_height, canvas_width, start_timestamp,
                              end_timestamp, source, viewer_type, label_type)
SELECT voided_label_validation.label_validation_id, voided_label_validation.label_id,
       voided_label_validation.validation_result, voided_label_validation.user_id, voided_label_validation.mission_id,
       voided_label_validation.canvas_x, voided_label_validation.canvas_y, voided_label_validation.heading,
       voided_label_validation.pitch, voided_label_validation.zoom, voided_label_validation.canvas_height,
       voided_label_validation.canvas_width, voided_label_validation.start_timestamp,
       voided_label_validation.end_timestamp, voided_label_validation.source, voided_label_validation.viewer_type,
       label.label_type
FROM restored
INNER JOIN voided_label_validation USING (label_validation_id)
INNER JOIN label ON voided_label_validation.label_id = label.label_id;

WITH edits AS (
  INSERT INTO label_edit (label_id, user_id, old_severity, new_severity, old_tags, new_tags, source, edit_time,
                          label_validation_id, old_label_type, new_label_type)
  SELECT voided_label_validation.label_id, voided_label_validation.user_id, voided_label_validation.old_severity,
         voided_label_validation.new_severity, voided_label_validation.old_tags, voided_label_validation.new_tags,
         voided_label_validation.source, voided_label_validation.old_history_edit_time,
         voided_label_validation.label_validation_id, label.label_type, label.label_type
  FROM restored
  INNER JOIN voided_label_validation USING (label_validation_id)
  INNER JOIN label ON voided_label_validation.label_id = label.label_id
  WHERE voided_label_validation.old_history_id IS NOT NULL
  RETURNING label_edit_id, label_validation_id
)
INSERT INTO label_history (label_history_id, label_id, severity, tags, edited_by, edit_time, source, label_edit_id,
                           label_type)
SELECT voided_label_validation.old_history_id, voided_label_validation.label_id, voided_label_validation.new_severity,
       voided_label_validation.old_history_tags, voided_label_validation.user_id,
       voided_label_validation.old_history_edit_time, voided_label_validation.source, edits.label_edit_id,
       label.label_type
FROM edits
INNER JOIN voided_label_validation USING (label_validation_id)
INNER JOIN label ON voided_label_validation.label_id = label.label_id;

UPDATE label_ai_assessment
SET label_validation_id = voided_label_validation.label_validation_id
FROM voided_label_validation
WHERE voided_label_validation.label_ai_assessment_id = label_ai_assessment.label_ai_assessment_id
  AND EXISTS (SELECT 1 FROM restored WHERE restored.label_validation_id = voided_label_validation.label_validation_id);

-- Counts and stats are re-derived, never restored from a snapshot, so votes cast since keep their effect.
UPDATE label
SET label_type = latest.label_type,
    severity = latest.severity,
    tags = latest.tags
FROM (
  SELECT DISTINCT ON (label_id) label_id, label_type, severity, tags
  FROM label_history
  WHERE label_id IN (SELECT label_id FROM restored)
  ORDER BY label_id, edit_time DESC, label_history_id DESC
) AS latest
WHERE latest.label_id = label.label_id
  AND (label.label_type <> latest.label_type OR label.severity IS DISTINCT FROM latest.severity
       OR NOT (label.tags <@ latest.tags AND latest.tags <@ label.tags));

UPDATE label
SET (agree_count, disagree_count, unsure_count, correct) = (n_agree, n_disagree, n_unsure, is_correct)
FROM (
  SELECT label.label_id,
         COUNT(*) FILTER (WHERE label_validation.validation_result = 'Agree') AS n_agree,
         COUNT(*) FILTER (WHERE label_validation.validation_result = 'Disagree') AS n_disagree,
         COUNT(*) FILTER (WHERE label_validation.validation_result = 'Unsure') AS n_unsure,
         CASE WHEN COUNT(*) FILTER (WHERE label_validation.validation_result = 'Agree')
                 > COUNT(*) FILTER (WHERE label_validation.validation_result = 'Disagree') THEN TRUE
              WHEN COUNT(*) FILTER (WHERE label_validation.validation_result = 'Disagree')
                 > COUNT(*) FILTER (WHERE label_validation.validation_result = 'Agree') THEN FALSE
              END AS is_correct
  FROM label
  LEFT JOIN label_validation ON label.label_id = label_validation.label_id
    AND label_validation.user_id <> label.user_id
    AND label_validation.label_type = label.label_type
    AND NOT EXISTS (SELECT 1 FROM user_stat
                    WHERE user_stat.user_id = label_validation.user_id AND user_stat.excluded)
  WHERE EXISTS (SELECT 1 FROM restored WHERE restored.label_id = label.label_id)
  GROUP BY label.label_id
) AS validation_count
WHERE label.label_id = validation_count.label_id;

UPDATE user_stat
SET own_labels_validated = COALESCE(recomputed.new_validated_count, 0),
    accuracy = recomputed.new_accuracy
FROM (
  SELECT affected_labeler.user_id,
         CAST(SUM(CASE WHEN label.correct THEN 1 ELSE 0 END) AS FLOAT)
           / NULLIF(SUM(CASE WHEN label.correct THEN 1 ELSE 0 END)
                    + SUM(CASE WHEN NOT label.correct THEN 1 ELSE 0 END), 0) AS new_accuracy,
         COUNT(CASE WHEN label.correct IS NOT NULL THEN 1 END) AS new_validated_count
  FROM (SELECT DISTINCT label.user_id FROM label
        INNER JOIN restored ON label.label_id = restored.label_id) AS affected_labeler
  LEFT JOIN (
    SELECT label.user_id, label.correct
    FROM label
    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
    WHERE (NOT label.deleted OR (label.deleted_source <> 'Explore' AND label.correct = FALSE))
      AND label.tutorial = FALSE
      AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
  ) AS label ON label.user_id = affected_labeler.user_id
  GROUP BY affected_labeler.user_id
) AS recomputed
WHERE user_stat.user_id = recomputed.user_id;

UPDATE user_stat
SET high_quality =
  NOT excluded
  AND COALESCE(high_quality_manual, TRUE)
  AND (COALESCE(high_quality_manual, FALSE)
       OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
           AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)))
FROM (SELECT DISTINCT label.user_id FROM label
      INNER JOIN restored ON label.label_id = restored.label_id) AS affected_labeler
WHERE user_stat.user_id = affected_labeler.user_id AND NOT user_stat.excluded;

DELETE FROM voided_label_validation
WHERE EXISTS (SELECT 1 FROM restored WHERE restored.label_validation_id = voided_label_validation.label_validation_id);

DROP TABLE old_label_point_linear;
COMMIT;
