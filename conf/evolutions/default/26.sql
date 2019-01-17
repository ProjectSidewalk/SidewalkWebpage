# --- !Ups
ALTER TABLE label
    ALTER COLUMN time_created TYPE TIMESTAMPTZ USING time_created AT TIME ZONE 'UTC',
    ALTER COLUMN time_created SET DEFAULT now();

# --- !Downs
ALTER TABLE label
    ALTER COLUMN time_created TYPE TIMESTAMP,
    ALTER COLUMN time_created DROP DEFAULT;
