# --- !Ups
ALTER TABLE user_stat
    ADD COLUMN accuracy DOUBLE PRECISION,
    ADD COLUMN exclude_manual BOOLEAN;

# --- !Downs
ALTER TABLE user_stat
    DROP COLUMN exclude_manual,
    DROP COLUMN accuracy;
