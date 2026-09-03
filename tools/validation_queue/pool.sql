-- One row per label that Validate could serve today: the exact joins and filters of
-- LabelTable.retrieveLabelListForValidationQuery (via labelsWithAuditTasksAndUserStats and imageryViewable), minus
-- only the two per-viewer predicates, which have no meaning for a whole-city analysis: "not my own label" and "not
-- already validated by me". Anything looser would count labels the queue never offers, which is how #4715's original
-- "58k unvalidated" ended up inflated by 36k tutorial labels.
--
-- Driven by tools/validation_queue/run.sh, which supplies the psql variables:
--   :schema            city schema to read (SET search_path, so no table here is schema-qualified)
--   :label_type_expr   the label's type as text  ('label_type.label_type' pre-373, 'label.label_type::text' after)
--   :label_type_join   the join that :label_type_expr needs (empty after evolution 373 dropped the lookup table)
--   :pano_source       the city's pano viewer source ('gsv' everywhere today)
--
-- NoSidewalk is deliberately kept in the export. The queue only serves it when it is the last type standing, so the
-- analysis reports every table both with and without it; filtering here would make that impossible.
--
-- Policy inputs are exported raw (own_labels_validated, low_quality, stale) rather than pre-reduced to a boolean, so
-- the analysis can vary the new-labeler threshold without a new export.
--
-- ai_result is the AI's *validation*, reached through label_ai_assessment.label_validation_id, because that is the
-- vote sitting inside agree_count/disagree_count and the column the label query reads. The assessment's own
-- validation_result disagrees with it on a quarter of Seattle's rows (a confident assessment that was cast as
-- Unsure), so reading the assessment instead would name thousands of labels human-vs-AI contested that are not.
SET search_path = :schema;

COPY (
    SELECT label.label_id,
           :label_type_expr AS label_type,
           label.agree_count,
           label.disagree_count,
           label.unsure_count,
           label.correct,
           user_stat.own_labels_validated,
           user_stat.high_quality,
           audit_task.low_quality,
           audit_task.stale,
           label.time_created > now() - interval '7 days' AS recent,
           label_validation.validation_result AS ai_result
    FROM label
    :label_type_join
    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
    INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
    INNER JOIN sidewalk_login.user_role ON user_stat.user_id = sidewalk_login.user_role.user_id
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
        AND pano_data.source = :'pano_source'
        -- imageryViewable: live imagery, or a backup we hold together with everything Pannellum needs to render it.
        AND (pano_data.expired = FALSE
            OR (COALESCE(pano_data.has_backup, TRUE)
                AND pano_data.width IS NOT NULL AND pano_data.height IS NOT NULL
                AND pano_data.lat IS NOT NULL AND pano_data.lng IS NOT NULL
                AND pano_data.camera_heading IS NOT NULL AND pano_data.camera_pitch IS NOT NULL))
        AND :label_type_expr IN ('CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'Crosswalk', 'Signal',
                                 'NoSidewalk')
    ORDER BY label.label_id
) TO STDOUT WITH CSV HEADER;
