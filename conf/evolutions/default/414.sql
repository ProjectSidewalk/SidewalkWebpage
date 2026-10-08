# --- !Ups
-- Provenance for AI labels retired by a resubmission (#5382). POST /ai/submitLabelsOnPano with overwrite=true
-- soft-deletes the AI user's earlier labels of that type on the pano, and label.deleted_source has to say that the
-- labeler pipeline did it rather than a person on some page. Adding a value inside a transaction is fine on PG 12+ as
-- long as the same transaction doesn't use it, and this evolution doesn't (332/339 precedent). IF NOT EXISTS guards
-- re-application across city schemas.
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'AiLabeler';

# --- !Downs
-- The enum value stays, since Postgres can't drop one without rebuilding the type and recasting every column that
-- uses it (339/361/400 precedent), and an unused value is harmless. Rows that carry it are not harmless: code from
-- before this evolution can't read the value back, so remap them to the catch-all. The text comparison keeps this
-- valid even where the value was never added, and the deleted_by test lets label_deleted_by_idx (partial on it) drive
-- the update instead of a scan of every label.
UPDATE label SET deleted_source = 'Old data, unknown source'
WHERE deleted_by IS NOT NULL AND deleted_source::text = 'AiLabeler';
