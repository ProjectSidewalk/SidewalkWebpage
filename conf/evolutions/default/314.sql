# --- !Ups
-- Track labels that the SidewalkAI API has refused permanently (e.g., the imagery is no longer available from Google
-- and we have no cached copy). Rows here cause getLabelsToValidateWithAi to skip the label, so we don't keep retrying.
CREATE TABLE IF NOT EXISTS label_ai_failure (
    label_id INT PRIMARY KEY REFERENCES label (label_id),
    reason TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

# --- !Downs
DROP TABLE IF EXISTS label_ai_failure;
