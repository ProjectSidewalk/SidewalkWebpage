-- One row per label that Validate could serve today: the exact joins and filters of
-- LabelTable.retrieveLabelListForValidationQuery (via labelsWithAuditTasksAndUserStats and imageryViewable), minus
-- only the two per-viewer predicates, which have no meaning for a whole-city analysis: "not my own label" and "not
-- already validated by me". Anything looser would count labels the queue never offers, which is how #4715's original
-- "58k unvalidated" ended up inflated by 36k tutorial labels.
--
-- READ-ONLY. SAFE TO RUN ON PROD. Built for sidewalk-server-tools/run-query-in-every-city.sh (-m), which sets the
-- search_path and the city variable; analyze_validation_queue.py --city picks one city back out of the merged CSV.
--
-- NoSidewalk is kept in the export with the columns its per-block-face queue reads (#5285): the street edge and side
-- that make up the face, who placed the label and whether that was the AI, and the label's age. The analysis reports
-- every table both with and without NoSidewalk, so the other six types' queue can be read on its own.
--
-- ai_labeler is an EXISTS over sidewalk_login.user_role rather than a join: a user can hold several role rows, and a
-- join would repeat every one of their labels once per row.
--
-- Policy inputs are exported raw (own_labels_validated, low_quality, stale) rather than pre-reduced to a boolean, so
-- the analysis can vary the new-labeler threshold without a new export.
--
-- ai_result is the AI's *validation*, reached through label_ai_assessment.label_validation_id, because that is the
-- vote sitting inside agree_count/disagree_count and the column the label query reads. The assessment's own
-- validation_result disagrees with it on a quarter of Seattle's rows (a confident assessment that was cast as
-- Unsure), so reading the assessment instead would name thousands of labels human-vs-AI contested that are not.
SELECT :'city' AS city,
       label.label_id,
       label.label_type::text AS label_type,
       label.agree_count,
       label.disagree_count,
       label.unsure_count,
       label.correct,
       user_stat.own_labels_validated,
       user_stat.high_quality,
       audit_task.low_quality,
       audit_task.stale,
       label.time_created > now() - interval '7 days' AS recent,
       label_validation.validation_result AS ai_result,
       label.street_edge_id,
       label_point.street_side::text AS street_side,
       label.user_id AS labeler_id,
       EXISTS (SELECT 1 FROM sidewalk_login.user_role
               WHERE user_role.user_id = label.user_id AND user_role.role = 'AI') AS ai_labeler,
       EXTRACT(EPOCH FROM now() - label.time_created) / 31557600 AS age_years
FROM label
INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
INNER JOIN label_point ON label.label_id = label_point.label_id
INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
LEFT JOIN label_ai_assessment ON label.label_id = label_ai_assessment.label_id
LEFT JOIN label_validation ON label_ai_assessment.label_validation_id = label_validation.label_validation_id
WHERE label.deleted = FALSE
    AND label.tutorial = FALSE
    AND user_stat.excluded = FALSE
    AND label.street_edge_id NOT IN (SELECT tutorial_street_edge_id FROM config)
    AND audit_task.street_edge_id NOT IN (SELECT tutorial_street_edge_id FROM config)
    AND label_point.lat IS NOT NULL
    AND label_point.lng IS NOT NULL
    -- Validate only ever serves one imagery source: whichever one the city's labels mostly sit on.
    AND pano_data.source = (SELECT source FROM pano_data GROUP BY source ORDER BY count(*) DESC LIMIT 1)
    -- imageryViewable: live imagery, or a backup we hold together with everything Pannellum needs to render it.
    AND (pano_data.expired = FALSE
        OR (COALESCE(pano_data.has_backup, TRUE)
            AND pano_data.width IS NOT NULL AND pano_data.height IS NOT NULL
            AND pano_data.lat IS NOT NULL AND pano_data.lng IS NOT NULL
            AND pano_data.camera_heading IS NOT NULL AND pano_data.camera_pitch IS NOT NULL))
    AND label.label_type::text IN ('CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Crosswalk', 'Signal',
                                   'NoSidewalk')
ORDER BY label.label_id;
