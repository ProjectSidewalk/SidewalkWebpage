-- Every validation ever cast on a label the queue could have served, in the order it was cast, for the historical
-- replay in analyze_validation_queue.py ("what was this label's margin at the moment of this vote?").
--
-- READ-ONLY. SAFE TO RUN ON PROD. Built for sidewalk-server-tools/run-query-in-every-city.sh (-m), which sets the
-- search_path and the city variable.
--
-- The filter here is looser than pool.sql on purpose: the replay asks what the crowd already spent, so it must keep
-- votes on labels whose imagery has since expired or whose labeler was later excluded. Only deleted and tutorial
-- labels are dropped, because a vote on either was never part of the crowd's real workload.
--
-- Rows come out grouped by label and ordered within a label, so the replay's running margin is well defined without
-- a sort that depends on timestamp ties; label_validation_id breaks a tie the same way every run.
--
-- is_ai is an EXISTS over sidewalk_login.user_role rather than a join, for the same reason as pool.sql's ai_labeler:
-- a user with several role rows would otherwise have every vote counted once per row.
SELECT :'city' AS city,
       label_validation.label_id,
       label.label_type::text AS label_type,
       label_validation.validation_result,
       label_validation.end_timestamp,
       label_validation.source,
       label_validation.user_id = label.user_id AS self_vote,
       EXISTS (SELECT 1 FROM sidewalk_login.user_role
               WHERE user_role.user_id = label_validation.user_id AND user_role.role = 'AI') AS is_ai
FROM label_validation
INNER JOIN label ON label_validation.label_id = label.label_id
WHERE label.deleted = FALSE
    AND label.tutorial = FALSE
ORDER BY label_validation.label_id, label_validation.end_timestamp, label_validation.label_validation_id;
