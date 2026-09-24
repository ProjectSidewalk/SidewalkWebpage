# --- !Ups
-- #5475: a canned reason for a Disagree or Unsure vote was only ever stored as the button's text, in whatever
-- language the validator was reading, so telling canned from free-text and counting per reason was a string match
-- at analysis time. The reason now travels as an id beside the text, from every surface that offers one (Validate,
-- the label detail card, the Gallery cards). NULL is a free-text comment, or one that predates the column.
--
-- An enum rather than a lookup table (docs/evolutions.md): a closed set the app writes at runtime, mirrored by
-- the Scala ValidationReason enumeration, whose catalog also says which types offer which reasons. Ids are
-- semantic, not positional, so a reason keeps its id when a menu reorders and one offered on two types counts once.
CREATE TYPE validation_reason AS ENUM (
  'wrong-type', 'driveway', 'driveway-transition', 'residential-walkway', 'no-sidewalk-here', 'unsafe-crossing',
  'not-pedestrian-path', 'ample-space', 'normal-tiles', 'sidewalk-here', 'traffic-median', 'no-visible-crosswalk',
  'stop-line', 'speed-bump', 'vehicle-signal-only', 'sign-no-light', 'pole-no-signal',
  'better-image', 'placement-incorrect', 'ramp-required-unsure', 'space-to-avoid-unsure', 'too-minor-unsure',
  'sidewalk-needed-unsure'
);

ALTER TABLE validation_task_comment ADD COLUMN reason validation_reason;
-- The history mirrors the live row it supersedes (378.sql), so a superseded reason is kept the same way.
ALTER TABLE validation_task_comment_history ADD COLUMN reason validation_reason;

-- The label card's comment feed carries the reason id, so it can mark the picked chip on a revisit and render the
-- reason in the reader's language rather than the writer's. Otherwise 395's view.
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
LEFT JOIN label_validation ON validation_task_comment.label_id = label_validation.label_id
    AND validation_task_comment.user_id = label_validation.user_id
    AND label_validation.label_type = label.label_type
GROUP BY validation_task_comment.label_id;

# --- !Downs
CREATE OR REPLACE VIEW label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp,
                                  'validation', label_validation.validation_result)
                ORDER BY validation_task_comment.timestamp)::text AS comments
FROM validation_task_comment
INNER JOIN sidewalk_user ON validation_task_comment.user_id = sidewalk_user.user_id
INNER JOIN label ON validation_task_comment.label_id = label.label_id
LEFT JOIN label_validation ON validation_task_comment.label_id = label_validation.label_id
    AND validation_task_comment.user_id = label_validation.user_id
    AND label_validation.label_type = label.label_type
GROUP BY validation_task_comment.label_id;

ALTER TABLE validation_task_comment_history DROP COLUMN reason;
ALTER TABLE validation_task_comment DROP COLUMN reason;
DROP TYPE validation_reason;
