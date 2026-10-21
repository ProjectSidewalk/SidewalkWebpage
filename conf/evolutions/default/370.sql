# --- !Ups
-- Each aggregated comment carries the commenter's current vote so the label-detail card can show it (#5015). The
-- LEFT JOIN cannot fan out because its right side, label_validation, is unique on (user_id, label_id), and a comment
-- whose vote was since cleared gets a JSON null. The left side is likewise one row per pair
-- (validation_task_comment_label_id_user_id_unique, added by 359 for #4942), so the join is strictly 1:1.
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

-- Gallery LEFT JOINs the whole label_comments_agg view per page, so the vote lookup above is computed for every
-- comment in the schema rather than for the ten labels on screen. With no index leading on label_id + user_id the
-- planner's only option is a full scan of label_validation, which bases the page's cost on the VALIDATION count --
-- the fastest-growing table here. On the Seattle dump (422k validations, 5.3k comments) a ten-label Gallery page
-- measured 12 ms before this evolution and 97 ms with the join added. INCLUDE (validation_result) makes the probe
-- index-only, which brings it to 27 ms and re-bases the cost on the comment count instead.
-- label_id leads the new index, so it serves every lookup label_validation_label_id_idx served (a btree answers any
-- query on a prefix of its columns). Dropping that one keeps the index count flat rather than maintaining two
-- indexes over the same leading column on a table written once per validation.
-- IF EXISTS on the drop only: 296 created that index in every schema, but this file applies to all 54 of them in
-- sequence on deploy, and one that drifted would otherwise abort the deploy at that city. It can't mask a real
-- problem, since the CREATE above it is unguarded.
CREATE INDEX label_validation_label_id_user_id_idx
    ON label_validation (label_id, user_id) INCLUDE (validation_result);
DROP INDEX IF EXISTS label_validation_label_id_idx;

# --- !Downs
CREATE INDEX IF NOT EXISTS label_validation_label_id_idx ON label_validation (label_id);
DROP INDEX label_validation_label_id_user_id_idx;

CREATE OR REPLACE VIEW label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp)
                ORDER BY validation_task_comment.timestamp)::text AS comments
FROM validation_task_comment
INNER JOIN sidewalk_user ON validation_task_comment.user_id = sidewalk_user.user_id
GROUP BY validation_task_comment.label_id;
