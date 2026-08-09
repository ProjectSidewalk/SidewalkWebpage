# --- !Ups
-- mission.pay is the schema's only `real` (float4) column -- every other floating-point column is double precision --
-- while MissionTable models it as Double. Slick binds a double precision parameter, Postgres narrows it to ~7
-- significant digits on write and widens it back on read, so a written value never comes back equal to itself (#4827).
-- Widening is lossless, so no USING clause and no data risk. The DEFAULT 0.0 carries over, and the model already
-- says Double.
ALTER TABLE mission ALTER COLUMN pay TYPE DOUBLE PRECISION;

-- These five AI-table columns are the only `timestamp without time zone` columns we own -- the other 39 timestamp
-- columns are all timestamptz -- yet every one is modeled in Slick as OffsetDateTime, which is a promise a zoneless
-- column cannot keep: the offset is discarded on write and re-invented on read from whatever zone the JVM happens to
-- be in, and a `WHERE timestamp > ?` comparison is off by that same offset (#4826). The USING clause is not optional.
-- Without it Postgres reads the stored values in the session's TimeZone, which would shift every existing row if this
-- ever ran outside UTC. Our containers all run UTC, so the stored values are UTC wall clocks and 'UTC' is the correct
-- reading of them.
ALTER TABLE label_ai_assessment
  ALTER COLUMN timestamp TYPE TIMESTAMPTZ USING "timestamp" AT TIME ZONE 'UTC',
  ALTER COLUMN validator_training_date TYPE TIMESTAMPTZ USING validator_training_date AT TIME ZONE 'UTC',
  ALTER COLUMN tagger_training_date TYPE TIMESTAMPTZ USING tagger_training_date AT TIME ZONE 'UTC';
ALTER TABLE label_ai_failure ALTER COLUMN timestamp TYPE TIMESTAMPTZ USING "timestamp" AT TIME ZONE 'UTC';
ALTER TABLE label_ai_info
  ALTER COLUMN model_training_date TYPE TIMESTAMPTZ USING model_training_date AT TIME ZONE 'UTC';

-- timezone('utc', now()) returns a timestamp *without* a zone -- the UTC wall clock as a bare number -- so assigning it
-- to a timestamptz column makes Postgres cast it back, and that cast reads the bare number in the session's TimeZone.
-- Under a UTC session that is identical to now(), which is why nothing is visibly wrong today. Under, say,
-- America/Chicago it stores an instant five hours in the future. now() returns a timestamptz directly and is correct in
-- every session, so it is the one form to use on these columns (#4826).
ALTER TABLE audit_task ALTER COLUMN task_start SET DEFAULT now();
ALTER TABLE audit_task ALTER COLUMN task_end SET DEFAULT now();
ALTER TABLE amt_assignment ALTER COLUMN assignment_start SET DEFAULT now();
ALTER TABLE amt_assignment ALTER COLUMN assignment_end SET DEFAULT now();
ALTER TABLE street_edge ALTER COLUMN timestamp SET DEFAULT now();

-- CURRENT_TIMESTAMP is now() by another name and has none of the problem above. These three change only so that the
-- schema has a single spelling to copy for the next column that needs a timestamp default (#4822).
ALTER TABLE clustering_session ALTER COLUMN timestamp SET DEFAULT now();
ALTER TABLE label_ai_assessment ALTER COLUMN timestamp SET DEFAULT now();
ALTER TABLE label_ai_failure ALTER COLUMN timestamp SET DEFAULT now();

# --- !Downs
-- Reading a timestamptz AT TIME ZONE 'UTC' gives back the UTC wall clock the Ups above interpreted, so this restores
-- the exact values the columns held before. The type changes come before the default restorations so that the
-- defaults, which Postgres rewrites with an explicit cast whenever a column's type changes under them, are left in
-- their original spelling.
ALTER TABLE label_ai_info
  ALTER COLUMN model_training_date TYPE TIMESTAMP USING model_training_date AT TIME ZONE 'UTC';
ALTER TABLE label_ai_failure ALTER COLUMN timestamp TYPE TIMESTAMP USING "timestamp" AT TIME ZONE 'UTC';
ALTER TABLE label_ai_assessment
  ALTER COLUMN tagger_training_date TYPE TIMESTAMP USING tagger_training_date AT TIME ZONE 'UTC',
  ALTER COLUMN validator_training_date TYPE TIMESTAMP USING validator_training_date AT TIME ZONE 'UTC',
  ALTER COLUMN timestamp TYPE TIMESTAMP USING "timestamp" AT TIME ZONE 'UTC';

ALTER TABLE label_ai_failure ALTER COLUMN timestamp SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE label_ai_assessment ALTER COLUMN timestamp SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE clustering_session ALTER COLUMN timestamp SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE street_edge ALTER COLUMN timestamp SET DEFAULT timezone('utc'::text, now());
ALTER TABLE amt_assignment ALTER COLUMN assignment_end SET DEFAULT timezone('utc'::text, now());
ALTER TABLE amt_assignment ALTER COLUMN assignment_start SET DEFAULT timezone('utc'::text, now());
ALTER TABLE audit_task ALTER COLUMN task_end SET DEFAULT timezone('utc'::text, now());
ALTER TABLE audit_task ALTER COLUMN task_start SET DEFAULT timezone('utc'::text, now());

ALTER TABLE mission ALTER COLUMN pay TYPE REAL;
