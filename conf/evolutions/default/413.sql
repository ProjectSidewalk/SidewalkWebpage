# --- !Ups
-- #5236: a background_job_run row is closed by the process that opened it, so a process that dies mid-run (a deploy,
-- a crash, an OOM kill) leaves its row 'running' forever, indistinguishable from a run still in progress. Each boot
-- now closes every row still open from before the process started (OrphanedJobRunSweep), and it marks them with a
-- value of their own rather than 'failed': a failed run recorded its own error, while an interrupted one says only
-- that the process died under it, and finished_at is when the next boot noticed, not when the work stopped.
-- Adding the value inside Play's evolution transaction is fine because nothing in that transaction uses it (the
-- sweep runs after evolutions commit). A later evolution that needs it must compare status::text, not the enum
-- literal (see docs/evolutions.md). No change to background_job_run_error_check: interrupted rows carry no message.
ALTER TYPE job_run_status ADD VALUE IF NOT EXISTS 'interrupted';

# --- !Downs
-- Postgres cannot drop an enum value without rebuilding the type, and an unused extra value is harmless, so the value
-- stays. Its rows fold into 'failed', the nearest outcome the older code understands (an interrupted run did not
-- succeed). Compared as text, the safe form for a value added by ADD VALUE.
UPDATE background_job_run SET status = 'failed' WHERE status::text = 'interrupted';
