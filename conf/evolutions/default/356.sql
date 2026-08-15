# --- !Ups
-- Machine-managed flag (#4384): TRUE on a completed audit whose street shows newer imagery than the audit across at
-- least half of its sampled points (street_imagery.median_newest_capture). Set AND cleared by the nightly
-- imagery-freshness sync, unlike the manually-set stale flag. A street with no street_imagery row (or a NULL
-- median_newest_capture) is assumed up to date, so its audits are never flagged.
-- Efficiency: metadata-only on Postgres 11+ (non-volatile default), no table rewrite even on prod-sized audit_task.
ALTER TABLE audit_task ADD COLUMN outdated_imagery BOOLEAN NOT NULL DEFAULT FALSE;

-- Flagged rows should be a small minority of audit_task, and the nightly clear-pass only ever scans this subset.
CREATE INDEX audit_task_street_edge_id_outdated_idx ON audit_task (street_edge_id) WHERE outdated_imagery;

-- street_imagery.data_source is a closed set of feeder names mirrored by a Scala enum (StreetImagerySource), and the
-- table is runtime-written and city-sized, so it gets a real enum type per the #4103 convention. `imagery_poll` is
-- the nightly in-app provider poll (CheckImageryAgeActor).
CREATE TYPE street_imagery_source AS ENUM ('pano_data', 'imagery_scan', 'imagery_poll');
ALTER TABLE street_imagery
    ALTER COLUMN data_source TYPE street_imagery_source USING data_source::street_imagery_source;

-- Capture date of the newest imagery at the street's *median* sampled point (#4384): at least half the street's
-- sample points show imagery at least this new. Written only by the nightly imagery-age poll, which snapshots a
-- fixed set of interior sample points per street -- labeling-observed panos are too positionally biased to support
-- a "half the street" claim, so refreshFromPanoData and the scan ingest leave it NULL. This is the column the
-- outdated_imagery sync compares audit dates against: a single newer pano (newest_capture) must NOT trigger a
-- re-audit, because a partial re-drive or one stray corner pano doesn't invalidate the audit of a whole street.
ALTER TABLE street_imagery ADD COLUMN median_newest_capture DATE;

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
-- newest_capture. Nearest-street (not every street in tolerance) because providers re-drive streets one at a time,
-- so a corner pano's date describes only its own street's drive. imagery_scan rows are untouched -- the scan samples
-- streets spatially and its ingest script fully replaces a row on conflict, so they carry no label-based
-- attribution. Panos with no stored position are simply left out. Runs in a minute or two on the largest cities
-- (one GiST probe per pano via the ST_DWithin geometry prefilter, and pano_data is far smaller than the label
-- tables).
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

ALTER TABLE street_imagery DROP COLUMN median_newest_capture;

ALTER TABLE street_imagery ALTER COLUMN data_source TYPE TEXT USING data_source::text;
DROP TYPE street_imagery_source;

ALTER TABLE audit_task DROP COLUMN outdated_imagery;
