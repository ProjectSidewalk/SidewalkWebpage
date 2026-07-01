# --- !Ups
-- Two per-user privacy flags backing the dashboard Settings page (#4323). on_leaderboard controls whether the user
-- appears by name in leaderboard rankings and their own standing widget. public_profile controls whether anyone can
-- open a public version of their dashboard from the leaderboard. Both default TRUE (public) so existing behavior is
-- unchanged. School and minor deployments flip the defaults to private per city via the app config key
-- city-params.private-profiles-by-default, which the sign-up path reads to seed these values FALSE for new users.
-- Kept next to excluded because it is the same kind of per-city leaderboard-eligibility boolean.
ALTER TABLE user_stat ADD COLUMN on_leaderboard BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE user_stat ADD COLUMN public_profile BOOLEAN NOT NULL DEFAULT TRUE;

# --- !Downs
ALTER TABLE user_stat DROP COLUMN on_leaderboard;
ALTER TABLE user_stat DROP COLUMN public_profile;
