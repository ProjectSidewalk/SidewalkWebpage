# --- !Ups
-- Per-deployment nightly-precomputed engagement funnels (#288), read cross-schema by the Across Cities admin page.
-- One row per (funnel_type, time_window, segment). funnel_type is mapping (6 steps) or contribution (3 steps, leaving
-- step4..step6 at 0). time_window is 30d, 90d, or all. segment is all, role:registered, role:anon, device:desktop,
-- device:mobile, or device:unknown. step1..step6 hold the monotonic funnel counts (distinct users reaching each step).
-- Small table (at most 36 rows), fully replaced each night by FunnelStatActor.
-- NOTE keep comments free of the semicolon character and quotes, because Play splits evolution SQL on that character
-- even inside comments (see #4351).
CREATE TABLE funnel_stat (
    funnel_type TEXT NOT NULL,
    time_window TEXT NOT NULL,
    segment TEXT NOT NULL,
    step1 INT NOT NULL DEFAULT 0,
    step2 INT NOT NULL DEFAULT 0,
    step3 INT NOT NULL DEFAULT 0,
    step4 INT NOT NULL DEFAULT 0,
    step5 INT NOT NULL DEFAULT 0,
    step6 INT NOT NULL DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (funnel_type, time_window, segment)
);

# --- !Downs
DROP TABLE funnel_stat;
