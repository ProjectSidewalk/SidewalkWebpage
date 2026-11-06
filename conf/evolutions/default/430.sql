# --- !Ups
-- Training examples of common validation mistakes, shown to new validators (#1445): an admin pins a label the crowd
-- has already voted wrong, with the canned reason. The label stays a real label, and the row only says it teaches.
CREATE TABLE gold_example (
  label_id INT PRIMARY KEY REFERENCES label (label_id),
  reason validation_reason NOT NULL,
  user_id TEXT NOT NULL REFERENCES sidewalk_login.sidewalk_user (user_id),
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE gold_example OWNER TO sidewalk;

-- One row per validator and example: written when the example is served, and the answer filled in when they vote.
-- A pinned label is served only as an example, never in the ordinary queue, so a Validate vote on one is its answer.
-- The answer is kept here rather than as a label_validation row because the examples are picked for being commonly
-- mistaken, so counting beginners' Agrees would vote a known-wrong label back to correct. The reason is copied from
-- the pin at serve time, so the record stays true if the pin later changes, and the row outlives the pin for the same
-- reason, hence the FK to label rather than gold_example. A deleted mission (account clean-up, a spec's teardown)
-- takes its serve record with it, as it does the mission's votes.
CREATE TABLE gold_example_response (
  gold_example_response_id SERIAL PRIMARY KEY,
  label_id INT NOT NULL REFERENCES label (label_id),
  user_id TEXT NOT NULL REFERENCES sidewalk_login.sidewalk_user (user_id),
  mission_id INT NOT NULL REFERENCES mission (mission_id) ON DELETE CASCADE,
  reason validation_reason NOT NULL,
  served_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validation_result validation_option,
  answer_reason validation_reason,
  answered_at TIMESTAMPTZ,
  CONSTRAINT gold_example_response_label_id_user_id_key UNIQUE (label_id, user_id),
  CONSTRAINT gold_example_response_answer_complete_check CHECK (
    (validation_result IS NULL AND answered_at IS NULL AND answer_reason IS NULL)
    OR (validation_result IS NOT NULL AND answered_at IS NOT NULL)
  )
);
ALTER TABLE gold_example_response OWNER TO sidewalk;
-- Validate reads a user's answers on every mission request and vote, and the unique index serves per-label lookups.
CREATE INDEX gold_example_response_user_id_idx ON gold_example_response (user_id);
-- Read per mission for its tally and for the one-example-per-mission check, and walked by the cascade on delete.
CREATE INDEX gold_example_response_mission_id_idx ON gold_example_response (mission_id);

# --- !Downs
DROP TABLE gold_example_response;
DROP TABLE gold_example;
