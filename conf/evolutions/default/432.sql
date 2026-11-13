# --- !Ups
-- #5063: how reliable each user's validations are. Filled in by the nightly user stats job, so every row starts
-- with nothing graded and no score.
ALTER TABLE user_stat
  ADD COLUMN validations_graded INT NOT NULL DEFAULT 0 CHECK (validations_graded >= 0),
  ADD COLUMN validations_matched INT NOT NULL DEFAULT 0 CHECK (validations_matched >= 0),
  ADD COLUMN validator_reliability DOUBLE PRECISION CHECK (validator_reliability BETWEEN 0 AND 1),
  ADD COLUMN validator_reliability_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT user_stat_matched_within_graded_check CHECK (validations_matched <= validations_graded),
  ADD CONSTRAINT user_stat_reliability_needs_graded_check
    CHECK ((validator_reliability IS NULL) = (validations_graded = 0));

# --- !Downs
ALTER TABLE user_stat
  DROP COLUMN validator_reliability_updated_at,
  DROP COLUMN validator_reliability,
  DROP COLUMN validations_matched,
  DROP COLUMN validations_graded;
