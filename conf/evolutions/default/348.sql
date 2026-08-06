# --- !Ups
-- Machine-managed flag (#4384): TRUE on a completed audit whose street has known imagery captured after the audit
-- ended (street_imagery.newest_capture). Set AND cleared by the nightly imagery-freshness sync, unlike the
-- manually-set stale flag. A street with no street_imagery row (or NULL newest_capture) is assumed up to date, so
-- its audits are never flagged.
ALTER TABLE audit_task ADD COLUMN outdated_imagery BOOLEAN NOT NULL DEFAULT FALSE;

-- Flagged rows should be a small minority of audit_task, and the nightly clear-pass only ever scans this subset.
CREATE INDEX audit_task_street_edge_id_outdated_idx ON audit_task (street_edge_id) WHERE outdated_imagery;

-- street_imagery.data_source is a closed set of feeder names, so constrain it rather than leaving it free text
-- (#4103). It is a small, script-and-nightly-job-written table, so a CHECK is the right tool over an enum type.
-- `imagery_poll` is the nightly in-app provider poll (CheckImageryAgeActor).
ALTER TABLE street_imagery
    ADD CONSTRAINT street_imagery_data_source_check
    CHECK (data_source IN ('pano_data', 'imagery_scan', 'imagery_poll'));

-- Invariants every writer already preserves (MIN/MAX on insert, LEAST/GREATEST widening on conflict): constrain them
-- while we're here rather than backfilling later (#3944 precedent).
ALTER TABLE street_imagery ADD CONSTRAINT street_imagery_n_panos_check CHECK (n_panos >= 0);
ALTER TABLE street_imagery
    ADD CONSTRAINT street_imagery_capture_order_check
    CHECK (oldest_capture IS NULL OR newest_capture IS NULL OR oldest_capture <= newest_capture);

# --- !Downs
ALTER TABLE street_imagery DROP CONSTRAINT street_imagery_capture_order_check;
ALTER TABLE street_imagery DROP CONSTRAINT street_imagery_n_panos_check;
ALTER TABLE street_imagery DROP CONSTRAINT street_imagery_data_source_check;

ALTER TABLE audit_task DROP COLUMN outdated_imagery;
