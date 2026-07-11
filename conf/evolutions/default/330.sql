# --- !Ups
-- Records a user's response to one of their own labels that others validated as incorrect (#2996): an optional
-- agree/contest vote plus an optional free-text note. agrees is nullable so a row can hold a vote only (agrees set,
-- comment null), a note only (agrees null, comment set), or both — the vote and note are set by independent operations
-- that each preserve the other field. One response per (label, user), re-responding updates it. Lets the dashboard
-- stop re-showing labels the user has already answered.
CREATE TABLE user_mistake_response (
    user_mistake_response_id SERIAL PRIMARY KEY,
    label_id INTEGER NOT NULL REFERENCES label (label_id),
    user_id TEXT NOT NULL,
    agrees BOOLEAN,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (label_id, user_id)
);
-- Reassign owner to sidewalk so the app role has the correct permissions on the prod server (see 309.sql for the pattern).
ALTER TABLE user_mistake_response OWNER TO sidewalk;

-- Two per-user privacy flags backing the dashboard Settings page (#4323). on_leaderboard controls whether the user
-- appears by name in leaderboard rankings and their own standing widget. public_profile controls whether anyone can
-- open a public version of their dashboard from the leaderboard.   Both default TRUE (public) so existing behavior is
-- unchanged. School and minor deployments flip the defaults to private per city via the app config key
-- city-params.private-profiles-by-default, which the sign-up path reads to seed these values FALSE for new users.
ALTER TABLE user_stat ADD COLUMN on_leaderboard BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE user_stat ADD COLUMN public_profile BOOLEAN NOT NULL DEFAULT TRUE;

# --- !Downs
ALTER TABLE user_stat DROP COLUMN public_profile;
ALTER TABLE user_stat DROP COLUMN on_leaderboard;
DROP TABLE user_mistake_response;
