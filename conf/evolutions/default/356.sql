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

-- Rebuild the pano_data-sourced rows with nearest-street pano attribution: a pano informs the single street nearest
-- its position, provided it is within 15 m (StreetImageryTable.PanoStreetToleranceMeters -- keep the two in sync).
-- The evolution-326 backfill attributed each pano to the street of the labels placed on it, but labelers routinely
-- observe panos that sit on a neighboring street (looking down a cross street from an intersection), which inflates
-- newest_capture and would trigger spurious outdated_imagery flags. Nearest-street (not every street in tolerance)
-- because providers re-drive streets one at a time, so a corner pano's date describes only its own street's drive.
-- imagery_scan rows are untouched -- the scan samples streets spatially and its ingest script fully replaces a row
-- on conflict, so they carry no label-based attribution. Panos with no stored position are simply left out. Runs in
-- a minute or two on the largest cities (one GiST probe per pano).
DELETE FROM street_imagery WHERE data_source = 'pano_data';

INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at)
SELECT nearest.street_edge_id,
       MIN(nearest.capture),
       MAX(nearest.capture),
       COUNT(DISTINCT nearest.pano_id),
       'pano_data',
       now()
FROM (
    SELECT DISTINCT ON (pano_data.pano_id)
           street_edge.street_edge_id AS street_edge_id,
           pano_data.pano_id          AS pano_id,
           CASE
               WHEN pano_data.capture_date ~ '^[0-9]{4}$'
                   THEN to_date(pano_data.capture_date, 'YYYY')
               WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}$'
                   THEN to_date(pano_data.capture_date, 'YYYY-MM')
               WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                   THEN to_date(pano_data.capture_date, 'YYYY-MM-DD')
           END AS capture
    FROM pano_data
    -- Geometry-space ST_DWithin runs first so the street_edge GiST index prunes candidates (0.001 deg is comfortably
    -- wider than 15 m at any real-city latitude), then the geography-space check applies the exact meter tolerance.
    -- DISTINCT ON + the ORDER BY keeps only the nearest candidate street per pano.
    JOIN street_edge
        ON ST_DWithin(street_edge.geom, ST_SetSRID(ST_MakePoint(pano_data.lng, pano_data.lat), 4326), 0.001)
        AND ST_DWithin(
                street_edge.geom::geography,
                ST_SetSRID(ST_MakePoint(pano_data.lng, pano_data.lat), 4326)::geography,
                15
            )
    WHERE pano_data.pano_id <> 'tutorial'
        AND pano_data.lat IS NOT NULL
        AND pano_data.lng IS NOT NULL
    ORDER BY pano_data.pano_id,
             ST_Distance(
                 street_edge.geom::geography,
                 ST_SetSRID(ST_MakePoint(pano_data.lng, pano_data.lat), 4326)::geography
             )
) AS nearest
WHERE nearest.capture IS NOT NULL
    AND nearest.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
GROUP BY nearest.street_edge_id
ON CONFLICT (street_edge_id) DO UPDATE
SET oldest_capture = LEAST(street_imagery.oldest_capture, EXCLUDED.oldest_capture),
    newest_capture = GREATEST(street_imagery.newest_capture, EXCLUDED.newest_capture),
    updated_at     = EXCLUDED.updated_at;

# --- !Downs
-- The pano_data row rebuild above is data-only and strictly more accurate, so it is not reversed.
ALTER TABLE street_imagery DROP CONSTRAINT street_imagery_capture_order_check;
ALTER TABLE street_imagery DROP CONSTRAINT street_imagery_n_panos_check;
ALTER TABLE street_imagery DROP CONSTRAINT street_imagery_data_source_check;

ALTER TABLE audit_task DROP COLUMN outdated_imagery;
