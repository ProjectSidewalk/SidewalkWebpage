# --- !Ups
-- Let a user leave a note on one of their mistakes without also casting an agree/contest vote (#2996). agrees becomes
-- nullable: a row can now hold a vote only (agrees set, comment null), a note only (agrees null, comment set), or both.
-- The vote and the note are recorded by independent operations that each preserve the other field.
ALTER TABLE user_mistake_response ALTER COLUMN agrees DROP NOT NULL;

# --- !Downs
-- A note-only row has no vote, so default agrees to a contest (FALSE) before restoring NOT NULL. Keep this comment
-- free of semicolons and quotes because Play splits evolution SQL on the semicolon even inside comments (see #4351).
UPDATE user_mistake_response SET agrees = FALSE WHERE agrees IS NULL;
ALTER TABLE user_mistake_response ALTER COLUMN agrees SET NOT NULL;
