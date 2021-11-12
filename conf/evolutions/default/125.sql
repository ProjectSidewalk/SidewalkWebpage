# --- !Ups
ALTER TABLE user_stat
    ADD COLUMN own_labels_validated INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN accuracy DOUBLE PRECISION,
    ADD COLUMN exclude_manual BOOLEAN;

# --- !Downs
ALTER TABLE user_stat
    DROP COLUMN exclude_manual,
    DROP COLUMN accuracy,
    DROP COLUMN own_labels_validated;
