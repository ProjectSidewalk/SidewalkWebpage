# --- !Ups
-- The HuggingFace commit of each model that made the assessment. A model id names a repo whose weights can be
-- re-uploaded, so without this, assessments from before and after a re-upload can't be told apart (#5794). Rows from
-- before this column existed stay null.
ALTER TABLE label_ai_assessment
  ADD COLUMN validator_revision TEXT,
  ADD COLUMN tagger_revision TEXT;

# --- !Downs
ALTER TABLE label_ai_assessment
  DROP COLUMN tagger_revision,
  DROP COLUMN validator_revision;
