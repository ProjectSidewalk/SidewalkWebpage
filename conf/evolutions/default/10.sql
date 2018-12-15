# --- !Ups
ALTER TABLE mission_user DROP COLUMN if exists pay_per_mile;
ALTER TABLE mission_user
  ADD pay_per_mile REAL NOT NULL DEFAULT 0.0;

# --- !Downs
ALTER TABLE mission_user
  DROP pay_per_mile;
