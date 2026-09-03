-- Every validation ever cast on a label the queue could have served, in the order it was cast, for the historical
-- replay in tools/analyze_validation_queue.py ("what was this label's margin at the moment of this vote?").
--
-- The filter here is looser than pool.sql on purpose: the replay asks what the crowd already spent, so it must keep
-- votes on labels whose imagery has since expired or whose labeler was later excluded. Only deleted and tutorial
-- labels are dropped, because a vote on either was never part of the crowd's real workload.
--
-- Driven by tools/validation_queue/run.sh, which supplies :schema, :label_type_expr and :label_type_join (see
-- pool.sql for what they mean).
--
-- Rows come out grouped by label and ordered within a label, so the replay's running margin is well defined without
-- a sort that depends on timestamp ties; label_validation_id breaks a tie the same way every run.
SET search_path = :schema;

COPY (
    SELECT label_validation.label_id,
           :label_type_expr AS label_type,
           label_validation.validation_result,
           label_validation.end_timestamp,
           label_validation.source,
           label_validation.user_id = label.user_id AS self_vote,
           sidewalk_login.user_role.role = 'AI' AS is_ai
    FROM label_validation
    INNER JOIN label ON label_validation.label_id = label.label_id
    :label_type_join
    INNER JOIN sidewalk_login.user_role ON label_validation.user_id = sidewalk_login.user_role.user_id
    WHERE label.deleted = FALSE
        AND label.tutorial = FALSE
    ORDER BY label_validation.label_id, label_validation.end_timestamp, label_validation.label_validation_id
) TO STDOUT WITH CSV HEADER;
