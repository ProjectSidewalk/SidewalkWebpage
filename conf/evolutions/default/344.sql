# --- !Ups
-- Machine-managed flag (#4384): TRUE on a completed audit whose street has known imagery captured after the audit
-- ended (street_imagery.newest_capture). Set AND cleared by the nightly imagery-freshness sync, unlike the
-- manually-set stale flag. A street with no street_imagery row (or NULL newest_capture) is assumed up to date, so
-- its audits are never flagged.
ALTER TABLE audit_task ADD COLUMN outdated_imagery BOOLEAN NOT NULL DEFAULT FALSE;

-- Flagged rows should be a small minority of audit_task, and the nightly clear-pass and the coverage queries that
-- isolate outdated audits only ever scan this subset.
CREATE INDEX audit_task_outdated_imagery_idx ON audit_task (street_edge_id) WHERE outdated_imagery;

# --- !Downs
ALTER TABLE audit_task DROP COLUMN outdated_imagery;
