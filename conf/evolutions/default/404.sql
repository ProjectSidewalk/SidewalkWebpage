# --- !Ups
-- So "is this user excluded?" checks skip reading all of user_stat (#5287). Explore runs one on every task fetch.
CREATE INDEX user_stat_excluded_user_id_idx ON user_stat (user_id) WHERE excluded;

# --- !Downs
DROP INDEX IF EXISTS user_stat_excluded_user_id_idx;
