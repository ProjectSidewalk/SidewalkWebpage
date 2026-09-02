-- =====================================================================================================================
-- ci-seed-slice.sql -- pulls the real-city slice that test/e2e/fixtures/ci-seed.sql should be rebuilt from (#5115).
--
-- READ-ONLY. SAFE TO RUN ON PROD. No writes, no temp tables, no search_path (the runner sets it).
--
-- Returns ONE row: a JSON document holding the city's config, the busiest labelled region, its four most-labelled
-- streets, every usable label on them, and the panoramas behind those labels. Run it for teaneck only:
--   ./run-query-in-every-city.sh -p -m -c "teaneck" -o "ci-seed-slice"
--
-- Deliberately NOT selected: label.description and any validation comment. Those are free text a contributor typed,
-- and this slice is going into a public repo -- the seed writes its own strings for those fields instead.
--
-- Geometry is simplified before it is emitted (topology-preserving, so street endpoints and x1/y1/x2/y2 still agree):
-- a raw neighbourhood boundary is thousands of vertices, which no one can read in a seed file. ~50 m for the region,
-- ~2 m for the streets. jsonb, not json, so the document comes back on a single line.
-- =====================================================================================================================
WITH tutorial_street AS (
    SELECT tutorial_street_edge_id AS street_edge_id FROM config
),
usable_label AS (
    -- The labels worth seeding at all: visible, positioned, and on a panorama carrying everything PannellumViewer
    -- needs (PanoData.requiredParams). A label whose pano lacks camera angles renders as the previous label's
    -- imagery under this label's marker (#4804), so it is no use in a fixture either.
    SELECT label.label_id,
           label.street_edge_id,
           label.pano_id,
           label.label_type_id,
           label.severity,
           label.tags,
           label_point.pano_x,
           label_point.pano_y,
           label_point.canvas_x,
           label_point.canvas_y,
           label_point.heading,
           label_point.pitch,
           label_point.zoom,
           label_point.lat,
           label_point.lng
    FROM label
    INNER JOIN label_point ON label_point.label_id = label.label_id
    INNER JOIN pano_data ON pano_data.pano_id = label.pano_id
    WHERE label.deleted = FALSE
      AND label.tutorial = FALSE
      AND label_point.lat IS NOT NULL
      AND label_point.lng IS NOT NULL
      AND pano_data.expired = FALSE
      AND pano_data.width IS NOT NULL
      AND pano_data.height IS NOT NULL
      AND pano_data.lat IS NOT NULL
      AND pano_data.lng IS NOT NULL
      AND pano_data.camera_heading IS NOT NULL
      AND pano_data.camera_pitch IS NOT NULL
),
picked_region AS (
    -- One region, chosen for CurbRamp depth: a validation mission is ten labels of a single type, and CurbRamp is
    -- the type the seed gives enough of so the server's random choice among eligible types has only one answer.
    SELECT street_edge_region.region_id
    FROM usable_label
    INNER JOIN street_edge_region ON street_edge_region.street_edge_id = usable_label.street_edge_id
    INNER JOIN region ON region.region_id = street_edge_region.region_id
    WHERE region.deleted = FALSE
    GROUP BY street_edge_region.region_id
    HAVING COUNT(*) FILTER (WHERE usable_label.label_type_id = 1) >= 12
       AND COUNT(DISTINCT usable_label.street_edge_id) >= 3
    ORDER BY COUNT(*) FILTER (WHERE usable_label.label_type_id = 1) DESC, street_edge_region.region_id
    LIMIT 1
),
picked_street AS (
    -- Four streets, so the region has one more than the three RouteBuilder needs. Open and non-tutorial, because
    -- that is what StreetEdgeTable's `streets` counts as auditable.
    SELECT street_edge.street_edge_id,
           street_edge.way_type::text AS way_type,
           street_edge.status::text AS status,
           street_edge.x1, street_edge.y1, street_edge.x2, street_edge.y2,
           ST_AsText(ST_SimplifyPreserveTopology(street_edge.geom, 0.00002)) AS geom_wkt,
           ROUND(ST_Length(street_edge.geom::geography)::numeric, 2) AS length_m,
           COUNT(usable_label.label_id) AS label_count
    FROM street_edge
    INNER JOIN street_edge_region ON street_edge_region.street_edge_id = street_edge.street_edge_id
    LEFT JOIN usable_label ON usable_label.street_edge_id = street_edge.street_edge_id
    WHERE street_edge_region.region_id = (SELECT region_id FROM picked_region)
      AND street_edge.status = 'open'
      AND street_edge.street_edge_id NOT IN (SELECT street_edge_id FROM tutorial_street)
    GROUP BY street_edge.street_edge_id, street_edge.way_type, street_edge.status,
             street_edge.x1, street_edge.y1, street_edge.x2, street_edge.y2, street_edge.geom
    HAVING COUNT(usable_label.label_id) > 0
    ORDER BY COUNT(usable_label.label_id) DESC, street_edge.street_edge_id
    LIMIT 4
),
ranked_label AS (
    -- Per type, not overall: a flat cap fills up on whichever type the region has most of (CurbRamp, always) and
    -- returns nothing for the rarer ones the share-page and edit specs fork on. Panoramas carrying a street address
    -- sort first, because one seeded label has to have one for the story card's location line.
    SELECT usable_label.*,
           label_type.label_type,
           ROW_NUMBER() OVER (
               PARTITION BY usable_label.label_type_id
               ORDER BY (pano_data.address IS NULL), usable_label.label_id
           ) AS rank_in_type
    FROM usable_label
    INNER JOIN label_type ON label_type.label_type_id = usable_label.label_type_id
    INNER JOIN pano_data ON pano_data.pano_id = usable_label.pano_id
    WHERE usable_label.street_edge_id IN (SELECT street_edge_id FROM picked_street)
),
picked_label AS (
    -- Well above what the seed keeps (~12 CurbRamps plus a few of each other type), so the final shape is a choice
    -- made against the data rather than one pinned here.
    SELECT * FROM ranked_label WHERE rank_in_type <= 20
)
SELECT :'city' AS city,
       JSONB_BUILD_OBJECT(
           'config', (SELECT TO_JSONB(c) FROM (
               SELECT city_center_lat, city_center_lng,
                      southwest_boundary_lat, southwest_boundary_lng,
                      northeast_boundary_lat, northeast_boundary_lng,
                      default_map_zoom, tutorial_street_edge_id, make_crops
               FROM config) c),
           'region', (SELECT TO_JSONB(r) FROM (
               SELECT region.region_id, region.name, region.data_source,
                      ST_AsText(ST_Multi(ST_SimplifyPreserveTopology(region.geom, 0.0005))) AS geom_wkt
               FROM region WHERE region.region_id = (SELECT region_id FROM picked_region)) r),
           'streets', (SELECT COALESCE(JSONB_AGG(s ORDER BY s.street_edge_id), '[]'::jsonb)
                       FROM picked_street s),
           'labels', (SELECT COALESCE(JSONB_AGG(l ORDER BY l.label_type_id, l.label_id), '[]'::jsonb)
                      FROM picked_label l),
           'panos', (SELECT COALESCE(JSONB_AGG(p ORDER BY p.pano_id), '[]'::jsonb) FROM (
               SELECT pano_data.pano_id, pano_data.source::text AS source, pano_data.capture_date,
                      pano_data.width, pano_data.height, pano_data.tile_width, pano_data.tile_height,
                      pano_data.lat, pano_data.lng,
                      pano_data.camera_heading, pano_data.camera_pitch, pano_data.camera_roll,
                      pano_data.copyright, pano_data.address
               FROM pano_data
               WHERE pano_data.pano_id IN (SELECT pano_id FROM picked_label)) p),
           'label_type_counts', (SELECT COALESCE(JSONB_OBJECT_AGG(label_type, n), '{}'::jsonb) FROM (
               SELECT label_type, COUNT(*) AS n FROM picked_label GROUP BY label_type) t)
       )::text AS slice;
