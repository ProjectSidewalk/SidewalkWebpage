# --- !Ups
-- Who deleted a label, when, and from which page (#3591). Users can now delete their own labels from the label popup
-- long after placing them, so a delete needs an author and a source to be undoable and to be told apart from an
-- Explore-session delete: a label deleted in Explore drops out of its labeler's accuracy as before, one deleted anywhere
-- else keeps an "incorrect" verdict, so deleting can never raise accuracy (LabelTable.countsTowardAccuracySql).
--
-- Every label deleted so far was deleted by its labeler in Explore, the only place that could, so those two columns
-- are backfilled. When it happened was never recorded, so deleted_at stays NULL for them and the CHECK doesn't require
-- it. The FK and CHECK each scan `label` once, and the partial index keeps a sidewalk_user delete from scanning it.
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
CREATE INDEX label_deleted_by_idx ON label (deleted_by) WHERE deleted_by IS NOT NULL;

-- The AccessScore page's label card has been sending this source all along, and is no longer refused for it.
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'AccessScore';

-- The AI validator's votes were written with canvas_height and canvas_width swapped (720 by 480 is the viewport's
-- width by height). Only its rows are touched, since a person's 480-wide by 720-tall canvas is a real portrait phone.
UPDATE label_validation
SET canvas_height = canvas_width, canvas_width = canvas_height
WHERE canvas_height = 720 AND canvas_width = 480
    AND user_id IN (SELECT user_id FROM user_role WHERE role = 'AI');

# --- !Downs
DROP INDEX label_deleted_by_idx;
ALTER TABLE label
  DROP CONSTRAINT label_deleted_provenance_check,
  DROP CONSTRAINT label_deleted_by_fkey,
  DROP COLUMN deleted_source,
  DROP COLUMN deleted_at,
  DROP COLUMN deleted_by;
