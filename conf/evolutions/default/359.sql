# --- !Ups
-- #4942: one comment per (label_id, user_id) has always been an app invariant. This evolution formalizes this in a
-- constraint, and cleans up the small number of exceptions that slipped through (future issues fixed in for #4942).
--
-- Prod's duplicates were resolved by hand before this ships, keeping or merging whichever comment the user meant.
DELETE FROM validation_task_comment
USING (
  SELECT validation_task_comment_id,
         row_number() OVER (PARTITION BY label_id, user_id
                            ORDER BY timestamp DESC, validation_task_comment_id DESC) AS newest_first
  FROM validation_task_comment
) superseded
WHERE superseded.validation_task_comment_id = validation_task_comment.validation_task_comment_id
  AND superseded.newest_first > 1;

-- Named and ordered to match label_validation_user_id_label_id_unique on the sibling table, except label_id leads
-- here because reads of this table filter by label alone (the label popup's comment list) far more often than by user.
ALTER TABLE validation_task_comment
  ADD CONSTRAINT validation_task_comment_label_id_user_id_unique UNIQUE (label_id, user_id);

# --- !Downs
ALTER TABLE validation_task_comment DROP CONSTRAINT validation_task_comment_label_id_user_id_unique;
