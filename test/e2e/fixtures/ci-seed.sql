-- Minimal seed for the e2e-smoke job's empty city schema (sidewalk_teaneck): one region containing the
-- template's seeded DC tutorial street (street_edge_id 1).
--
-- Why: with zero region rows, /explore is a server error before any JS runs (region assignment finds
-- nothing to assign). With one region, every fresh anonymous user deterministically starts the audit
-- TUTORIAL, whose panorama tiles are local assets (/assets/images/pano-tutorial/) — no live Street View
-- imagery is fetched. The tutorial street itself is excluded from real audit tasks, so nothing ever
-- requests live GSV panos either.
--
-- Applied by ci.yml after the app boots, i.e. after evolutions have brought the schema to HEAD.
-- Idempotent so a job retry can re-run it.
INSERT INTO sidewalk_teaneck.region (region_id, data_source, name, geom, deleted)
VALUES (1, 'e2e-smoke-seed', 'Smoke Test Region',
        ST_Multi(ST_GeomFromText(
          'POLYGON((-77.069 38.939, -77.066 38.939, -77.066 38.942, -77.069 38.942, -77.069 38.939))', 4326)),
        false)
ON CONFLICT (region_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.street_edge_region (street_edge_id, region_id)
SELECT 1, 1
WHERE NOT EXISTS (SELECT 1 FROM sidewalk_teaneck.street_edge_region WHERE street_edge_id = 1);

INSERT INTO sidewalk_teaneck.street_edge_priority (street_edge_id, priority)
VALUES (1, 1.0)
ON CONFLICT (street_edge_id) DO NOTHING;
