# --- !Ups
-- Intersections as a first-class AccessScore unit (#5095). Four of the seven scored label types (CurbRamp,
-- NoCurbRamp, Crosswalk, Signal) are corner features, and a cluster is credited to the one street its labeler walked,
-- so a corner ramp was either credited to a single street or double-counted across two. This derives the
-- intersections from the street graph and lets a cluster point at the one it sits at.
--
-- street_edge is fully noded (every place two streets meet is a shared endpoint), so an intersection is a group of
-- street endpoints with three or more distinct incident edges. Endpoints within ~1 m are merged: on Seattle that
-- recovers ~2% more intersections (a degree-2 node on a sliver edge a meter from a degree-4 node), while 3 m starts
-- fusing distinct real intersections. Degree 2 is a way split (a curve, a region boundary), degree 1 a dead end.
--
-- grade_separated marks a false intersection: the import planarized bridges and tunnels into shared endpoints, so
-- Aurora Ave N (bridge=yes, layer=1) over N 46th St shows up as two degree-4 nodes. The rule reads the OSM tags the
-- nightly refresh caches in osm_way: a node is grade-separated when two or more ways that pass THROUGH it (two of
-- their edges meet there) sit on different layers. A way that merely ends at the node (a bridge abutment) never
-- flags. Verified 44/44 against live OSM node-sharing on Richmond. A schema whose osm_way is still empty gets FALSE
-- everywhere, and the nightly rebuild (IntersectionService) corrects it once the tags arrive.
--
-- The derivation below is the same one IntersectionTable.derivationSql holds, so a rebuild reproduces these rows
-- exactly (IntersectionTableSpec checks that), and ids stay stable across rebuilds unless a node moves over a meter.
CREATE TABLE intersection (
    intersection_id SERIAL PRIMARY KEY,
    geom geometry(Point, 4326) NOT NULL,
    degree INTEGER NOT NULL CHECK (degree >= 3),
    grade_separated BOOLEAN NOT NULL DEFAULT FALSE,
    region_id INTEGER REFERENCES region(region_id)
);
ALTER TABLE intersection OWNER TO sidewalk;
CREATE INDEX intersection_geom_idx ON intersection USING GIST (geom);
CREATE INDEX intersection_region_id_idx ON intersection (region_id);

-- Which streets meet at which intersection, and by which end, so a street can report its start and end intersections
-- and an intersection can pool the clusters of every street touching it. A deleted street takes its links with it
-- (as street_edge_region does), and the next rebuild re-derives the node it was part of.
CREATE TABLE intersection_street_edge (
    intersection_street_edge_id SERIAL PRIMARY KEY,
    intersection_id INTEGER NOT NULL REFERENCES intersection(intersection_id) ON DELETE CASCADE,
    street_edge_id INTEGER NOT NULL REFERENCES street_edge(street_edge_id) ON DELETE CASCADE,
    street_end TEXT NOT NULL CHECK (street_end IN ('start', 'end')),
    UNIQUE (street_edge_id, street_end)
);
ALTER TABLE intersection_street_edge OWNER TO sidewalk;
CREATE INDEX intersection_street_edge_intersection_id_idx ON intersection_street_edge (intersection_id);

-- The intersection a corner-type cluster is attributed to, or NULL for a mid-block one (and for every along-length
-- type). SET NULL rather than CASCADE: a vanished intersection must not delete the cluster, only detach it, and the
-- rebuild re-attributes in the same transaction. The index keeps that cascade cheap.
ALTER TABLE cluster ADD COLUMN intersection_id INTEGER REFERENCES intersection(intersection_id) ON DELETE SET NULL;
CREATE INDEX cluster_intersection_id_idx ON cluster (intersection_id);

-- Derive every existing city's intersections. Every street counts, whatever its status: the topology is physical.
-- Prod scale: ~55k endpoints in Seattle through one DBSCAN pass and hash aggregates, seconds per schema.
WITH endpoint AS (
    SELECT street_edge_id, 'start' AS street_end, ST_StartPoint(geom) AS pt FROM street_edge
    UNION ALL
    SELECT street_edge_id, 'end' AS street_end, ST_EndPoint(geom) AS pt FROM street_edge
),
grouped AS (
    SELECT street_edge_id, street_end, pt,
           ST_ClusterDBSCAN(pt, eps := 0.00001, minpoints := 1) OVER () AS node_group
    FROM endpoint
),
-- An edge with both ends in one group is a sliver inside the node, not a street meeting it.
member AS (
    SELECT node_group, street_edge_id, street_end, pt
    FROM (
        SELECT grouped.*, COUNT(*) OVER (PARTITION BY node_group, street_edge_id) AS ends_in_group
        FROM grouped
    ) counted
    WHERE ends_in_group = 1
),
node AS (
    SELECT node_group, ST_Centroid(ST_Collect(pt)) AS geom, COUNT(*) AS degree
    FROM member
    GROUP BY node_group
    HAVING COUNT(*) >= 3
),
-- The region most of the node's streets are in, so intersections roll up the way streets do. Ties go to the lowest id.
node_region AS (
    SELECT member.node_group, MODE() WITHIN GROUP (ORDER BY street_edge_region.region_id) AS region_id
    FROM member
    INNER JOIN street_edge_region ON member.street_edge_id = street_edge_region.street_edge_id
    GROUP BY member.node_group
),
-- Per OSM way at the node: how many of its edges meet there, and its layer. A layer tag that isn't an integer is
-- ignored rather than aborting the deploy for every city after it. An edge with no way maps to a key of its own, so
-- it can never create a separation.
way_layer AS (
    SELECT member.node_group,
           COALESCE(osm_way_street_edge.osm_way_id, -member.street_edge_id) AS way_key,
           COUNT(*) AS edges_at_node,
           CASE WHEN osm_way.tags ->> 'layer' ~ '^-?[0-9]+$' THEN (osm_way.tags ->> 'layer')::INTEGER
                WHEN COALESCE(osm_way.tags ->> 'bridge', 'no') <> 'no' THEN 1
                WHEN COALESCE(osm_way.tags ->> 'tunnel', 'no') <> 'no' THEN -1
                ELSE 0 END AS layer
    FROM member
    LEFT JOIN osm_way_street_edge ON member.street_edge_id = osm_way_street_edge.street_edge_id
    LEFT JOIN osm_way ON osm_way_street_edge.osm_way_id = osm_way.osm_way_id
    GROUP BY member.node_group, way_key, layer
),
node_grade AS (
    SELECT node_group, COUNT(DISTINCT layer) FILTER (WHERE edges_at_node >= 2) >= 2 AS grade_separated
    FROM way_layer
    GROUP BY node_group
),
inserted AS (
    INSERT INTO intersection (geom, degree, grade_separated, region_id)
    SELECT node.geom, node.degree, COALESCE(node_grade.grade_separated, FALSE), node_region.region_id
    FROM node
    LEFT JOIN node_grade ON node.node_group = node_grade.node_group
    LEFT JOIN node_region ON node.node_group = node_region.node_group
    RETURNING intersection_id, geom
)
INSERT INTO intersection_street_edge (intersection_id, street_edge_id, street_end)
SELECT inserted.intersection_id, member.street_edge_id, member.street_end
FROM inserted
INNER JOIN node ON inserted.geom = node.geom
INNER JOIN member ON node.node_group = member.node_group;

-- Attribute every corner-type cluster to the nearest intersection within 25 m (geodesic), on any street. The degree
-- box is the index prefilter (0.0005 degrees is at least 28 m anywhere a city sits) and the geography test the real
-- radius. The type list and the radius are AccessScoreCalculator.intersectionTypeNames / attributionRadiusMeters.
UPDATE cluster
SET intersection_id = nearest.intersection_id
FROM (
    SELECT cluster.cluster_id, candidate.intersection_id
    FROM cluster
    CROSS JOIN LATERAL (
        SELECT intersection.intersection_id
        FROM intersection
        WHERE NOT intersection.grade_separated
          AND ST_DWithin(intersection.geom, cluster.geom, 0.0005)
          AND ST_DWithin(intersection.geom::geography, cluster.geom::geography, 25)
        ORDER BY ST_Distance(intersection.geom::geography, cluster.geom::geography)
        LIMIT 1
    ) candidate
    WHERE cluster.label_type IN ('CurbRamp', 'NoCurbRamp', 'Crosswalk', 'Signal')
) nearest
WHERE cluster.cluster_id = nearest.cluster_id;

# --- !Downs
ALTER TABLE cluster DROP COLUMN intersection_id;
DROP TABLE intersection_street_edge;
DROP TABLE intersection;
