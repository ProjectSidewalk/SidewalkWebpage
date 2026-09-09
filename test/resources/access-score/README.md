# AccessScore snapshot fixture (Teaneck, NJ)

A snapshot of the per-cluster scoring inputs the v3 AccessScore endpoints read, taken from the `sidewalk_teaneck`
schema on **2026-09-07** (with evolution 380's intersections applied). `AccessScoreTeaneckSnapshotSpec` scores every audited street from it with the pure
`AccessScoreCalculator` and asserts distributional properties of the model on real labeling behavior — the things a
hand-built unit case can't show, such as how the NoSidewalk street-condition term behaves across 660 real streets
with anywhere from 1 to 69 clusters each (#5093).

All files are gzipped CSV with a header row.

| file | rows | columns |
|---|---|---|
| `teaneck-streets.csv.gz` | one per street edge | `street_edge_id`, `audit_count` (completed audits), `length_meters` (geodesic), `start_intersection_id`, `end_intersection_id` (empty = none) |
| `teaneck-cluster-rows.csv.gz` | one per cluster of a scored label type | `street_edge_id`, `intersection_id` (empty = not attributed), `label_type`, `severity` (empty = null), `label_count`, `tag_counts` (JSON object, quoted) |
| `teaneck-intersections.csv.gz` | one per intersection | `intersection_id`, `degree`, `grade_separated` (`t`/`f`), `region_id`, `audit_count` (completed high-quality audits summed over its streets) |

The cluster rows are exactly what `ClusterTable.getClusterScoreRows` streams to `AccessScoreService`, minus the bbox
filter. To refresh the snapshot, run the three `COPY` queries below against a city schema (whose evolutions include
380, so the intersection tables exist) and gzip the output with `gzip -n` (the spec assumes a city with a few hundred
audited NoSidewalk streets, at least one cluster of every scored type, and a few hundred scored intersections; its
thresholds are loose enough for any city with that much data).

**The second query's `WHERE label_type IN (...)` must list exactly `AccessScoreCalculator.scoredTypeNames`.** That set
is the source of truth, and this SQL is a hand-maintained copy of it, so a scored type added or removed on the Scala
side has to be reflected here before the snapshot is regenerated. `AccessScoreTeaneckSnapshotSpec` asserts the fixture's
label types equal `scoredTypeNames` and fails pointing at this file if they drift.

```sql
COPY (
  SELECT street_edge.street_edge_id,
         COUNT(audit_task.audit_task_id) AS audit_count,
         ROUND(ST_Length(street_edge.geom::geography)::numeric, 1) AS length_meters,
         start_link.intersection_id AS start_intersection_id,
         end_link.intersection_id AS end_intersection_id
  FROM street_edge
  LEFT JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id AND audit_task.completed = TRUE
  LEFT JOIN intersection_street_edge start_link
      ON street_edge.street_edge_id = start_link.street_edge_id AND start_link.street_end = 'start'
  LEFT JOIN intersection_street_edge end_link
      ON street_edge.street_edge_id = end_link.street_edge_id AND end_link.street_end = 'end'
  GROUP BY street_edge.street_edge_id, start_link.intersection_id, end_link.intersection_id
  ORDER BY 1
) TO STDOUT WITH CSV HEADER;

COPY (
  SELECT cluster.street_edge_id,
         cluster.intersection_id,
         cluster.label_type::text AS label_type,
         cluster.severity,
         label_counts.label_count,
         cluster_tag_counts.tag_counts
  FROM cluster
  INNER JOIN (
      SELECT cluster_label.cluster_id, COUNT(label.label_id) AS label_count
      FROM cluster_label
      INNER JOIN label ON cluster_label.label_id = label.label_id
      GROUP BY cluster_label.cluster_id
  ) label_counts ON cluster.cluster_id = label_counts.cluster_id
  INNER JOIN (
      SELECT cluster.cluster_id,
             COALESCE(jsonb_object_agg(tag_counts.tag, tag_counts.cnt) FILTER (WHERE tag_counts.tag IS NOT NULL), '{}') AS tag_counts
      FROM cluster
      LEFT JOIN (
          SELECT cluster_label.cluster_id, t.tag, COUNT(*) AS cnt
          FROM cluster_label
          INNER JOIN label ON cluster_label.label_id = label.label_id
          CROSS JOIN LATERAL unnest(label.tags) AS t(tag)
          GROUP BY cluster_label.cluster_id, t.tag
      ) tag_counts ON cluster.cluster_id = tag_counts.cluster_id
      GROUP BY cluster.cluster_id
  ) cluster_tag_counts ON cluster.cluster_id = cluster_tag_counts.cluster_id
  WHERE cluster.label_type IN ('CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk', 'Crosswalk', 'Signal')
  ORDER BY cluster.street_edge_id, cluster.label_type, cluster.cluster_id
) TO STDOUT WITH CSV HEADER;

COPY (
  SELECT intersection.intersection_id, intersection.degree, intersection.grade_separated, intersection.region_id,
         COALESCE(SUM(audits.audit_count), 0) AS audit_count
  FROM intersection
  INNER JOIN (SELECT DISTINCT intersection_id, street_edge_id FROM intersection_street_edge) incident
      ON intersection.intersection_id = incident.intersection_id
  LEFT JOIN (
      SELECT audit_task.street_edge_id, COUNT(*) AS audit_count
      FROM audit_task
      INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
      WHERE audit_task.completed AND user_stat.high_quality
      GROUP BY audit_task.street_edge_id
  ) audits ON incident.street_edge_id = audits.street_edge_id
  GROUP BY intersection.intersection_id
  ORDER BY 1
) TO STDOUT WITH CSV HEADER;
```

Project Sidewalk data is CC0; the snapshot carries street and intersection ids, cluster summaries, and tag counts only
— no user ids, label ids, or coordinates.
