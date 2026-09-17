# --- !Ups
-- #3671: a label's type can change after it is placed. Three tables record that, and a fourth constraint closes a gap
-- the change would otherwise open.

-- 1. The edit itself. label_edit is the source of truth for every post-creation change (#2575), so a type change is
--    one more thing an edit can carry. Both columns are always set and are equal on an edit that only touched severity
--    or tags, the way old_tags/new_tags are always present.
ALTER TABLE label_edit
  ADD COLUMN old_label_type label_type,
  ADD COLUMN new_label_type label_type;

UPDATE label_edit
SET old_label_type = label.label_type,
    new_label_type = label.label_type
FROM label
WHERE label.label_id = label_edit.label_id;

-- An unrated type (no 1-3 rating in LabelTypeEnum.RatingScale) never carries a severity. Until now only the frontend
-- enforced that, and Explore has leaked a few dozen per city since 2025, so the leaked values go first (as 291 did)
-- and the backend now nulls the severity for these types itself. The three names are pinned to the Scala enum by
-- LabelTypeEnumDbSpec.
UPDATE label SET severity = NULL WHERE severity IS NOT NULL AND label_type IN ('Signal', 'NoSidewalk', 'Occlusion');

UPDATE label_history
SET severity = NULL
FROM label
WHERE label.label_id = label_history.label_id
  AND label_history.severity IS NOT NULL
  AND label.label_type IN ('Signal', 'NoSidewalk', 'Occlusion');

-- None found locally, but an edit whose only change was one of those severities would be a no-op once nulled, so it
-- and its history row go rather than tripping the not-noop check below.
DELETE FROM label_history
USING label_edit, label
WHERE label_edit.label_edit_id = label_history.label_edit_id
  AND label.label_id = label_edit.label_id
  AND label.label_type IN ('Signal', 'NoSidewalk', 'Occlusion')
  AND label_edit.old_tags <@ label_edit.new_tags AND label_edit.new_tags <@ label_edit.old_tags;

DELETE FROM label_edit
USING label
WHERE label.label_id = label_edit.label_id
  AND label.label_type IN ('Signal', 'NoSidewalk', 'Occlusion')
  AND label_edit.old_tags <@ label_edit.new_tags AND label_edit.new_tags <@ label_edit.old_tags;

UPDATE label_edit
SET old_severity = NULL,
    new_severity = NULL
FROM label
WHERE label.label_id = label_edit.label_id
  AND (label_edit.old_severity IS NOT NULL OR label_edit.new_severity IS NOT NULL)
  AND label.label_type IN ('Signal', 'NoSidewalk', 'Occlusion');

ALTER TABLE label_edit
  ALTER COLUMN old_label_type SET NOT NULL,
  ALTER COLUMN new_label_type SET NOT NULL,
  DROP CONSTRAINT label_edit_not_noop_check,
  ADD CONSTRAINT label_edit_not_noop_check
    CHECK (old_label_type IS DISTINCT FROM new_label_type
      OR old_severity IS DISTINCT FROM new_severity
      OR NOT (old_tags <@ new_tags AND new_tags <@ old_tags)),
  ADD CONSTRAINT label_edit_unrated_no_severity_check
    CHECK ((old_severity IS NULL OR old_label_type NOT IN ('Signal', 'NoSidewalk', 'Occlusion'))
      AND (new_severity IS NULL OR new_label_type NOT IN ('Signal', 'NoSidewalk', 'Occlusion')));

-- 2. The state log, so each row is again the whole label as it stood at that moment.
ALTER TABLE label_history ADD COLUMN label_type label_type;

UPDATE label_history
SET label_type = label.label_type
FROM label
WHERE label.label_id = label_history.label_id;

ALTER TABLE label_history
  ALTER COLUMN label_type SET NOT NULL,
  ADD CONSTRAINT label_history_unrated_no_severity_check
    CHECK (severity IS NULL OR label_type NOT IN ('Signal', 'NoSidewalk', 'Occlusion'));

-- 3. Votes remember the type they judged. A vote counts toward a label's agree/disagree/unsure counts only while this
--    equals label.label_type, so after a type change the old votes stay as history and the label is validated afresh.
--    The unique key gains the type: a validator served the label again after a change casts a new row instead of
--    overwriting the old one. The (label_id, user_id) lookup index stays, since every lookup still starts from those.
ALTER TABLE label_validation ADD COLUMN label_type label_type;

UPDATE label_validation
SET label_type = label.label_type
FROM label
WHERE label.label_id = label_validation.label_id;

ALTER TABLE label_validation
  ALTER COLUMN label_type SET NOT NULL,
  DROP CONSTRAINT label_validation_user_id_label_id_unique,
  ADD CONSTRAINT label_validation_user_id_label_id_label_type_key UNIQUE (user_id, label_id, label_type);

-- 4. The same no-severity rule on the label itself.
ALTER TABLE label
  ADD CONSTRAINT label_unrated_no_severity_check
    CHECK (severity IS NULL OR label_type NOT IN ('Signal', 'NoSidewalk', 'Occlusion'));

-- 5. The comment list pairs each comment with its writer's vote. A writer can now hold a vote per type (say they
-- voted, an admin retyped the label, and they voted again), and 370's join would list their comment once per vote,
-- so it takes the vote on the label's current type -- the only one that counts.
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

# --- !Downs

-- Back to 370's join, which is unique again once the votes above are gone.
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

-- The severities nulled on unrated labels stay null.
ALTER TABLE label DROP CONSTRAINT label_unrated_no_severity_check;

-- A label's type change can't be undone from here. Votes cast on an earlier type would collide with the two-column
-- key, so only the vote on the label's current type survives, along with whatever pointed at the others (355.sql
-- precedent for the assessment link).
CREATE TEMP TABLE stale_votes_395 AS
SELECT label_validation.label_validation_id
FROM label_validation
INNER JOIN label ON label.label_id = label_validation.label_id
WHERE label_validation.label_type <> label.label_type;

UPDATE label_ai_assessment
SET label_validation_id = NULL
WHERE label_validation_id IN (SELECT label_validation_id FROM stale_votes_395);

UPDATE voided_label_history
SET label_validation_id = NULL
WHERE label_validation_id IN (SELECT label_validation_id FROM stale_votes_395);

DELETE FROM label_history
USING label_edit
WHERE label_edit.label_edit_id = label_history.label_edit_id
  AND label_edit.label_validation_id IN (SELECT label_validation_id FROM stale_votes_395);

DELETE FROM label_edit WHERE label_validation_id IN (SELECT label_validation_id FROM stale_votes_395);

DELETE FROM label_validation WHERE label_validation_id IN (SELECT label_validation_id FROM stale_votes_395);

DROP TABLE stale_votes_395;

ALTER TABLE label_validation
  DROP CONSTRAINT label_validation_user_id_label_id_label_type_key,
  DROP COLUMN label_type,
  ADD CONSTRAINT label_validation_user_id_label_id_unique UNIQUE (user_id, label_id);

ALTER TABLE label_history
  DROP CONSTRAINT label_history_unrated_no_severity_check,
  DROP COLUMN label_type;

-- An edit that changed only the type records no change once the type columns are gone, so it and its history row go.
DELETE FROM label_history
USING label_edit
WHERE label_edit.label_edit_id = label_history.label_edit_id
  AND label_edit.old_label_type <> label_edit.new_label_type
  AND label_edit.old_severity IS NOT DISTINCT FROM label_edit.new_severity
  AND label_edit.old_tags <@ label_edit.new_tags AND label_edit.new_tags <@ label_edit.old_tags;

DELETE FROM label_edit
WHERE old_label_type <> new_label_type
  AND old_severity IS NOT DISTINCT FROM new_severity
  AND old_tags <@ new_tags AND new_tags <@ old_tags;

ALTER TABLE label_edit
  DROP CONSTRAINT label_edit_unrated_no_severity_check,
  DROP CONSTRAINT label_edit_not_noop_check,
  DROP COLUMN old_label_type,
  DROP COLUMN new_label_type,
  ADD CONSTRAINT label_edit_not_noop_check
    CHECK (old_severity IS DISTINCT FROM new_severity OR NOT (old_tags <@ new_tags AND new_tags <@ old_tags));
