# --- !Ups
-- Who deleted a label, when, and from which page (#3591). Users can now delete their own labels from the label popup
-- long after placing them, so a delete needs an author and a source to be undoable and to be told apart from an
-- Explore-session delete: a label deleted in Explore drops out of its labeler's accuracy as before, one deleted anywhere
-- else keeps an "incorrect" verdict, so deleting can never raise accuracy or high_quality
-- (LabelTable.countsTowardAccuracySql).
--
-- Every label deleted so far was deleted by its labeler in Explore, the only place that could, so those two columns
-- are backfilled. When it happened was never recorded, so deleted_at stays NULL for them and the CHECK doesn't require
-- it. The FK and CHECK each scan `label` once.
ALTER TABLE label
  ADD COLUMN deleted_by TEXT,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_source ui_source;

UPDATE label SET deleted_by = user_id, deleted_source = 'Explore' WHERE deleted;

ALTER TABLE label
  ADD CONSTRAINT label_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES sidewalk_login.sidewalk_user (user_id),
  ADD CONSTRAINT label_deleted_provenance_check CHECK (
    (deleted AND deleted_by IS NOT NULL AND deleted_source IS NOT NULL)
    OR (NOT deleted AND deleted_by IS NULL AND deleted_at IS NULL AND deleted_source IS NULL)
  );

# --- !Downs
ALTER TABLE label
  DROP CONSTRAINT label_deleted_provenance_check,
  DROP CONSTRAINT label_deleted_by_fkey,
  DROP COLUMN deleted_source,
  DROP COLUMN deleted_at,
  DROP COLUMN deleted_by;
