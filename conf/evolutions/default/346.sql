# --- !Ups
-- The Across Cities trailing-window activity queries (the daily trend and the week-over-week window summary, #4758)
-- bound the label leg on label.time_created and the validation leg on label_validation.end_timestamp, neither of which
-- has an evolution-managed index. Some prod schemas carry a manually created label_time_created_idx (it appears in
-- dumps but in no evolution), hence IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS label_time_created_idx ON label (time_created);
CREATE INDEX IF NOT EXISTS label_validation_end_timestamp_idx ON label_validation (end_timestamp);

# --- !Downs
DROP INDEX IF EXISTS label_validation_end_timestamp_idx;
DROP INDEX IF EXISTS label_time_created_idx;
