# --- !Ups
-- Per-street imagery age (#4348). One row per street, aggregating the capture dates of the panos observed on it, so the
-- app can surface a "stale imagery" signal alongside street_edge_status (#3888) -- a street can have imagery and still be
-- years out of date. data_source records which feeder produced the row: 'pano_data' (this in-app backfill) or
-- 'imagery_scan' (the check_streets_for_imagery.py summary, ingested by db/scripts/import-street-imagery.sh).
CREATE TABLE street_imagery (
    street_edge_id INTEGER PRIMARY KEY REFERENCES street_edge (street_edge_id),
    oldest_capture DATE,
    newest_capture DATE,
    n_panos INTEGER NOT NULL,
    data_source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

-- Feeder 1 backfill: every audited street gets imagery age for free from pano_data, joined to streets via label (which
-- carries both pano_id and street_edge_id, so no spatial join is needed) -- at zero API cost, and covering Mapillary and
-- Infra3d panos too. pano_data.capture_date is a varying-precision string (YYYY, YYYY-MM, or YYYY-MM-DD), so we
-- standardize each to a date exactly the way the script's standardize_capture_date does: a year-only value becomes
-- January 1st, a year-month becomes the 1st, and anything unparseable is dropped. The tutorial pano is excluded so the
-- tutorial street gets no bogus row.
INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at)
SELECT dated.street_edge_id,
       MIN(dated.capture),
       MAX(dated.capture),
       COUNT(DISTINCT dated.pano_id),
       'pano_data',
       now()
FROM (
    SELECT label.street_edge_id AS street_edge_id,
           pano_data.pano_id    AS pano_id,
           CASE
               WHEN pano_data.capture_date ~ '^[0-9]{4}$'             THEN to_date(pano_data.capture_date, 'YYYY')
               WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}$'    THEN to_date(pano_data.capture_date, 'YYYY-MM')
               WHEN pano_data.capture_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN to_date(pano_data.capture_date, 'YYYY-MM-DD')
           END AS capture
    FROM label
    JOIN pano_data ON label.pano_id = pano_data.pano_id
    WHERE pano_data.pano_id <> 'tutorial'
) AS dated
WHERE dated.capture IS NOT NULL
GROUP BY dated.street_edge_id;

# --- !Downs
DROP TABLE street_imagery;
