-- Patched mainline 27.sql (issue #4700). The original TRUNCATEs amt_assignment because old rows
-- violate the new NOT NULLs. DC's 662 rows all have confirmation_code; only assignment_end needs
-- a backfill (480 rows) — assignment_start is the best available bound.
UPDATE amt_assignment SET assignment_end = assignment_start WHERE assignment_end IS NULL;
ALTER TABLE amt_assignment ALTER COLUMN confirmation_code SET NOT NULL;
ALTER TABLE amt_assignment ALTER COLUMN assignment_end SET NOT NULL;
