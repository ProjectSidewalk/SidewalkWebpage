# --- !Ups
-- #5849: the Raw Labels API lists validator comments beside the votes, keyed by user_id like the `validations` list,
-- and reads them from this view so the API and the label card can't drift. The card keeps using `username`.
-- Otherwise 423's view.
CREATE OR REPLACE VIEW label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp,
                                  'validation', label_validation.validation_result,
                                  'reason', validation_task_comment.reason,
                                  'user_id', validation_task_comment.user_id)
                ORDER BY validation_task_comment.timestamp)::text AS comments
FROM validation_task_comment
INNER JOIN sidewalk_user ON validation_task_comment.user_id = sidewalk_user.user_id
INNER JOIN label ON validation_task_comment.label_id = label.label_id
    AND validation_task_comment.label_type = label.label_type
LEFT JOIN label_validation ON validation_task_comment.label_id = label_validation.label_id
    AND validation_task_comment.user_id = label_validation.user_id
    AND label_validation.label_type = validation_task_comment.label_type
GROUP BY validation_task_comment.label_id;

# --- !Downs
-- Back to 423's view.
CREATE OR REPLACE VIEW label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp,
                                  'validation', label_validation.validation_result,
                                  'reason', validation_task_comment.reason)
                ORDER BY validation_task_comment.timestamp)::text AS comments
FROM validation_task_comment
INNER JOIN sidewalk_user ON validation_task_comment.user_id = sidewalk_user.user_id
INNER JOIN label ON validation_task_comment.label_id = label.label_id
    AND validation_task_comment.label_type = label.label_type
LEFT JOIN label_validation ON validation_task_comment.label_id = label_validation.label_id
    AND validation_task_comment.user_id = label_validation.user_id
    AND label_validation.label_type = validation_task_comment.label_type
GROUP BY validation_task_comment.label_id;
