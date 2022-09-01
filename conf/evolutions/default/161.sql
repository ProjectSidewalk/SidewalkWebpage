# --- !Ups
UPDATE user_stat SET exclude_manual = FALSE WHERE exclude_manual IS NULL;
ALTER TABLE user_stat ALTER COLUMN exclude_manual SET NOT NULL;

# --- !Downs
ALTER TABLE user_stat ALTER COLUMN exclude_manual DROP NOT NULL;
UPDATE user_stat SET exclude_manual = NULL WHERE exclude_manual = FALSE;
