# --- !Ups
-- Records a user's response to one of their own labels that others validated as incorrect (#2996): whether they agree
-- it was a mistake or contest it (claim it was actually correct), with an optional comment. One response per
-- (label, user) — re-responding updates it. Gives contributors agency over "your mistakes" and lets the dashboard
-- stop re-showing labels the user has already answered.
CREATE TABLE user_mistake_response (
    user_mistake_response_id SERIAL PRIMARY KEY,
    label_id INTEGER NOT NULL REFERENCES label (label_id),
    user_id TEXT NOT NULL,
    agrees BOOLEAN NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (label_id, user_id)
);

# --- !Downs
DROP TABLE user_mistake_response;
