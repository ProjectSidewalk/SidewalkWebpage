# --- !Ups
-- Each aggregated comment carries the commenter's current vote so the label-detail card can show it (#5015). The
-- LEFT JOIN is 1:1 with no fan-out: label_validation and validation_task_comment are both unique on
-- (label_id, user_id), and a comment whose vote was cleared gets a JSON null.
CREATE OR REPLACE VIEW label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp,
                                  'validation', label_validation.validation_result)
                ORDER BY validation_task_comment.timestamp)::text AS comments
FROM validation_task_comment
INNER JOIN sidewalk_user ON validation_task_comment.user_id = sidewalk_user.user_id
LEFT JOIN label_validation ON validation_task_comment.label_id = label_validation.label_id
    AND validation_task_comment.user_id = label_validation.user_id
GROUP BY validation_task_comment.label_id;

# --- !Downs
CREATE OR REPLACE VIEW label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp)
                ORDER BY validation_task_comment.timestamp)::text AS comments
FROM validation_task_comment
INNER JOIN sidewalk_user ON validation_task_comment.user_id = sidewalk_user.user_id
GROUP BY validation_task_comment.label_id;
