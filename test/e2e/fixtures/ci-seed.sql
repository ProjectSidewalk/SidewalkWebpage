-- Minimal seed for CI's empty city schema (sidewalk_teaneck), so /explore can initialize: one region + one
-- auditable street. Applied by ci.yml in BOTH the e2e-smoke job (after the app boots) and the backend-tests job
-- (after its evolutions step), always once the schema is at evolution HEAD — it writes street_edge.status, which
-- the committed template lacks, and its ON CONFLICT targets need constraints the template lacks too. Idempotent
-- so a job retry can re-run it.
--
-- Why a region: with zero region rows, /explore is a server error before any JS runs (region assignment
-- finds nothing to assign; #4748). With one, every fresh anonymous user deterministically starts the audit
-- TUTORIAL, whose panorama tiles are local assets (/assets/images/pano-tutorial/) — no live Street View
-- imagery is fetched.
--
-- Why a second street: the region must contain at least one NON-tutorial street. Region "completion" is
-- computed over auditable streets, and the tutorial street (street_edge_id 1, the only street in the
-- template) is excluded from that set — so a region holding only the tutorial street has 0 auditable
-- streets, counts as vacuously completed by every user, and is excluded from assignment (same 500 as no
-- region at all). Street 2 clones street 1's geometry; the tutorial-only smoke spec never audits it, so
-- its pano is never requested.
INSERT INTO sidewalk_teaneck.region (region_id, data_source, name, geom, deleted)
VALUES (1, 'e2e-smoke-seed', 'Smoke Test Region',
        ST_Multi(ST_GeomFromText(
          'POLYGON((-77.069 38.939, -77.066 38.939, -77.066 38.942, -77.069 38.942, -77.069 38.939))', 4326)),
        false)
ON CONFLICT (region_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
SELECT 2, geom, x1, y1, x2, y2, way_type, status
FROM sidewalk_teaneck.street_edge
WHERE street_edge_id = 1
ON CONFLICT (street_edge_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.street_edge_region (street_edge_id, region_id)
SELECT 2, 1
WHERE NOT EXISTS (SELECT 1 FROM sidewalk_teaneck.street_edge_region WHERE street_edge_id = 2);

INSERT INTO sidewalk_teaneck.street_edge_priority (street_edge_id, priority)
VALUES (2, 1.0)
ON CONFLICT (street_edge_id) DO NOTHING;
