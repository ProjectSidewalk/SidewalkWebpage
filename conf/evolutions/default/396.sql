# --- !Ups
-- 370 added label_validation (label_id, user_id) INCLUDE (validation_result) so the comment view's vote lookup stays
-- index-only, which is what holds a Gallery page's cost to the comment count rather than the validation count -- the
-- fastest-growing table there. 395 gave that view a label_type predicate (a writer can hold a vote per type, and only
-- the one on the label's current type belongs beside their comment), so the INCLUDE carries label_type too or every
-- comment pays a heap fetch.
--
-- Its own evolution rather than a section of 395: this is the one statement in the pair that rewrites an index over
-- every validation, and on its own it takes its locks briefly and alone, instead of holding them for the rest of
-- 395's work on `label` and `label_validation` -- which is how a deploy applying 395 under traffic deadlocks.
--
-- The replacement is built before the old one goes, so the lookup is never without an index to use.
CREATE INDEX label_validation_label_id_user_id_type_idx
    ON label_validation (label_id, user_id) INCLUDE (validation_result, label_type);
DROP INDEX label_validation_label_id_user_id_idx;

# --- !Downs
CREATE INDEX label_validation_label_id_user_id_idx
    ON label_validation (label_id, user_id) INCLUDE (validation_result);
DROP INDEX label_validation_label_id_user_id_type_idx;
