# --- !Ups
-- #5510: a validator's comment is about the label type they were shown, like their vote (395.sql). After a type
-- change, a comment on the old type would otherwise keep showing on the label as if it were about the new one. Old
-- comments are kept, not archived, so they come back with their votes if the type change is undone.
ALTER TABLE validation_task_comment ADD COLUMN label_type label_type;
ALTER TABLE validation_task_comment_history ADD COLUMN label_type label_type;

-- Backfill: the type of the vote the comment was submitted with (same mission), else the mission's type. Missions are
-- per type, so the mission alone is exact except for an admin's type-changing Agree, whose vote is on the new type.
UPDATE validation_task_comment
SET label_type = comment_type.label_type
FROM (
  SELECT DISTINCT ON (validation_task_comment.validation_task_comment_id)
         validation_task_comment.validation_task_comment_id,
         COALESCE(label_validation.label_type, mission.label_type, label.label_type) AS label_type
  FROM validation_task_comment
  INNER JOIN mission ON validation_task_comment.mission_id = mission.mission_id
  INNER JOIN label ON validation_task_comment.label_id = label.label_id
  LEFT JOIN label_validation ON validation_task_comment.label_id = label_validation.label_id
      AND validation_task_comment.user_id = label_validation.user_id
      AND validation_task_comment.mission_id = label_validation.mission_id
  ORDER BY validation_task_comment.validation_task_comment_id, label_validation.label_validation_id DESC
) AS comment_type
WHERE comment_type.validation_task_comment_id = validation_task_comment.validation_task_comment_id;

UPDATE validation_task_comment_history
SET label_type = comment_type.label_type
FROM (
  SELECT DISTINCT ON (validation_task_comment_history.validation_task_comment_history_id)
         validation_task_comment_history.validation_task_comment_history_id,
         COALESCE(label_validation.label_type, mission.label_type, label.label_type) AS label_type
  FROM validation_task_comment_history
  INNER JOIN mission ON validation_task_comment_history.mission_id = mission.mission_id
  INNER JOIN label ON validation_task_comment_history.label_id = label.label_id
  LEFT JOIN label_validation ON validation_task_comment_history.label_id = label_validation.label_id
      AND validation_task_comment_history.user_id = label_validation.user_id
      AND validation_task_comment_history.mission_id = label_validation.mission_id
  ORDER BY validation_task_comment_history.validation_task_comment_history_id, label_validation.label_validation_id DESC
) AS comment_type
WHERE comment_type.validation_task_comment_history_id
  = validation_task_comment_history.validation_task_comment_history_id;

ALTER TABLE validation_task_comment_history ALTER COLUMN label_type SET NOT NULL;

-- label_id still leads, so the label card's lookup by label keeps its index.
ALTER TABLE validation_task_comment
  ALTER COLUMN label_type SET NOT NULL,
  DROP CONSTRAINT validation_task_comment_label_id_user_id_unique,
  ADD CONSTRAINT validation_task_comment_label_id_user_id_label_type_key UNIQUE (label_id, user_id, label_type);

CREATE OR REPLACE VIEW label_comments_agg AS
SELECT validation_task_comment.label_id,
       json_agg(json_build_object('username', sidewalk_user.username, 'comment', validation_task_comment.comment,
                                  'time_created', validation_task_comment.timestamp,
                                  'validation', label_validation.validation_result)
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

-- Back to 395's view, which lists every comment regardless of type.
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

-- The two-column key allows one comment per user per label, so keep the one on the label's current type (else the
-- newest) and move the rest into the history, where their text survives.
CREATE TEMP TABLE extra_comments_409 AS
SELECT ranked.validation_task_comment_id
FROM (
  SELECT validation_task_comment.validation_task_comment_id,
         row_number() OVER (PARTITION BY validation_task_comment.label_id, validation_task_comment.user_id
                            ORDER BY (validation_task_comment.label_type = label.label_type) DESC,
                                     validation_task_comment.timestamp DESC,
                                     validation_task_comment.validation_task_comment_id DESC) AS keep_rank
  FROM validation_task_comment
  INNER JOIN label ON validation_task_comment.label_id = label.label_id
) ranked
WHERE ranked.keep_rank > 1;

INSERT INTO validation_task_comment_history (validation_task_comment_id, mission_id, label_id, user_id, ip_address,
                                             pano_id, heading, pitch, zoom, lat, lng, timestamp, comment, change_type,
                                             label_type)
SELECT validation_task_comment.validation_task_comment_id, mission_id, label_id, user_id, ip_address, pano_id, heading,
       pitch, zoom, lat, lng, timestamp, comment, 'validation_change', label_type
FROM validation_task_comment
INNER JOIN extra_comments_409
    ON validation_task_comment.validation_task_comment_id = extra_comments_409.validation_task_comment_id;

DELETE FROM validation_task_comment
USING extra_comments_409
WHERE validation_task_comment.validation_task_comment_id = extra_comments_409.validation_task_comment_id;

DROP TABLE extra_comments_409;

ALTER TABLE validation_task_comment
  DROP CONSTRAINT validation_task_comment_label_id_user_id_label_type_key,
  ADD CONSTRAINT validation_task_comment_label_id_user_id_unique UNIQUE (label_id, user_id),
  DROP COLUMN label_type;
ALTER TABLE validation_task_comment_history DROP COLUMN label_type;
