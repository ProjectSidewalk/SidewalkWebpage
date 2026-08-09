# --- !Ups
-- mission.pay is the schema's only `real` (float4) column -- every other floating-point column is double precision --
-- while MissionTable models it as Double. Slick binds a double precision parameter, Postgres narrows it to ~7
-- significant digits on write and widens it back on read, so a written value never comes back equal to itself (#4827).
-- Widening is lossless, so no USING clause and no data risk. The DEFAULT 0.0 carries over, and the model already
-- says Double.
ALTER TABLE mission ALTER COLUMN pay TYPE DOUBLE PRECISION;

# --- !Downs
ALTER TABLE mission ALTER COLUMN pay TYPE REAL;
