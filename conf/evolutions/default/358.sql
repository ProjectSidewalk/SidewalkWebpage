# --- !Ups
-- #4928: record *transitions*, not just current state. Every imagery/street-status surface we have is a snapshot, so
-- "what newly expired this week" and "which streets were closed this month" are unanswerable -- and a nightly job
-- that silently stopped looks exactly like a nightly job that found nothing to do. Three additions cover the three
-- blind spots: when a pano's imagery went away, when a street's status changed and what changed it, and whether each
-- background job ran at all.

-- When the pano's imagery went away, as distinct from last_checked ("when did we last look"), which every sweep bumps
-- whether or not anything changed. Left NULL for panos that expired before this evolution: last_checked has already
-- been overwritten by re-checks, so the original flip date is not recoverable. Metadata-only add (nullable, no
-- default), so no table rewrite even on prod-sized pano_data.
ALTER TABLE pano_data ADD COLUMN expired_at TIMESTAMPTZ;
ALTER TABLE pano_data ADD CONSTRAINT pano_data_expired_at_check CHECK (expired OR expired_at IS NULL);

-- Same pattern for the re-audit flag (#4384): outdated_imagery says a completed audit predates its street's newer
-- imagery, but not since when -- so flag-to-re-audit latency and "newly flagged this week" are unanswerable without
-- it. The sync's set-pass stamps it (that pass only touches unflagged rows, so the stamp marks the false-to-true
-- edge and re-runs leave it alone) and the clear-pass nulls it. Left NULL for audits already flagged when this
-- evolution runs: their flip date was never recorded.
ALTER TABLE audit_task ADD COLUMN outdated_imagery_at TIMESTAMPTZ;
ALTER TABLE audit_task ADD CONSTRAINT audit_task_outdated_imagery_at_check
    CHECK (outdated_imagery OR outdated_imagery_at IS NULL);

-- street_edge.status has no application write path at all: it is written only by the hand-run scripts in db/scripts
-- (hide-streets-without-imagery.sh, reveal-or-hide-neighborhoods.sh, remove_streets.sql). Nothing recorded that a run
-- happened, which streets it touched, or what it changed them from -- so this table is also the only trace those
-- scripts leave behind.
--
-- source is a real enum rather than free text (the #4103 convention) so a typo in a shell script fails loudly instead
-- of silently splitting a series into two. Growing the set later is ALTER TYPE ... ADD VALUE. Note that city seeding
-- (fill-new-schema.sh) writes no rows here: those streets are created at their status, they do not transition to it.
CREATE TYPE street_edge_status_change_source AS ENUM (
    'hide_streets_without_imagery', 'reveal_neighborhoods', 'hide_neighborhoods', 'remove_streets'
);

CREATE TABLE street_edge_status_change (
    street_edge_status_change_id SERIAL PRIMARY KEY,
    street_edge_id INTEGER NOT NULL REFERENCES street_edge (street_edge_id) ON DELETE CASCADE,
    old_status street_edge_status NOT NULL,
    new_status street_edge_status NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source street_edge_status_change_source NOT NULL,
    -- Only real transitions belong here. The writers all guard with `AND status <> '<new>'`, without which re-running
    -- the same no-imagery CSV would stamp thousands of rows and fake a spike of newly-identified streets.
    CONSTRAINT street_edge_status_change_real_transition_check CHECK (old_status <> new_status)
);
ALTER TABLE street_edge_status_change OWNER TO sidewalk;

-- ON DELETE CASCADE above rather than a manual cleanup line in remove_streets.sql: once the street row is gone, its
-- status history describes nothing.

-- The trend charts scan by time and split by destination status, so lead with changed_at.
CREATE INDEX street_edge_status_change_changed_at_idx ON street_edge_status_change (changed_at);
CREATE INDEX street_edge_status_change_street_edge_id_idx ON street_edge_status_change (street_edge_id);

-- Every scheduled actor in app/actor/ logs a one-line summary and persists nothing, so "did last night's imagery
-- sweep run, how much did it cover, is its error rate climbing" can only be answered by grepping server logs -- if
-- they are still around. One row per run, opened when the job starts and closed when it settles.
CREATE TYPE job_run_status AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE job_run_trigger AS ENUM ('scheduled', 'manual');

CREATE TABLE background_job_run (
    background_job_run_id SERIAL PRIMARY KEY,
    -- The actor's pekko name (CheckImageExpiryActor.Name and friends), so job identity has one source of truth.
    job_name TEXT NOT NULL,
    triggered_by job_run_trigger NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status job_run_status NOT NULL,
    -- Per-job counts. JSONB rather than typed columns because every job reports a different shape (panos checked vs.
    -- audits flagged vs. users updated), same as clustering_session.thresholds.
    details JSONB,
    error_message TEXT,
    CONSTRAINT background_job_run_finished_check CHECK (finished_at IS NULL OR finished_at >= started_at),
    -- A run is open exactly while it is 'running'. Keeps a crashed run from being read as a completed one.
    CONSTRAINT background_job_run_running_check CHECK ((status = 'running') = (finished_at IS NULL)),
    CONSTRAINT background_job_run_error_check CHECK (error_message IS NULL OR status = 'failed')
);
ALTER TABLE background_job_run OWNER TO sidewalk;

-- Both reads are "the latest run of each job" and "this job's failures over the last N days". Roughly eight rows a
-- night, so the table stays a few thousand rows a year and needs no pruning.
CREATE INDEX background_job_run_job_name_started_at_idx ON background_job_run (job_name, started_at DESC);

# --- !Downs
DROP TABLE background_job_run;
-- Tables and types share a namespace, so the types can only go once nothing references them.
DROP TYPE job_run_trigger;
DROP TYPE job_run_status;

DROP TABLE street_edge_status_change;
DROP TYPE street_edge_status_change_source;

ALTER TABLE audit_task DROP CONSTRAINT audit_task_outdated_imagery_at_check;
ALTER TABLE audit_task DROP COLUMN outdated_imagery_at;

ALTER TABLE pano_data DROP CONSTRAINT pano_data_expired_at_check;
ALTER TABLE pano_data DROP COLUMN expired_at;
