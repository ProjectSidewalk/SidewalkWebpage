# AccessScore snapshot fixture (Teaneck, NJ)

A snapshot of the per-cluster scoring inputs the v3 AccessScore endpoints read, taken from the `sidewalk_teaneck`
schema on **2026-09-02**. `AccessScoreTeaneckSnapshotSpec` scores every audited street from it with the pure
`AccessScoreCalculator` and asserts distributional properties of the model on real labeling behavior — the things a
hand-built unit case can't show, such as how the NoSidewalk street-condition term behaves across 660 real streets
with anywhere from 1 to 69 clusters each (#5093).

Both files are gzipped CSV with a header row.

| file | rows | columns |
|---|---|---|
| `teaneck-streets.csv.gz` | one per street edge | `street_edge_id`, `audit_count` (completed audits), `length_meters` (geodesic) |
| `teaneck-cluster-rows.csv.gz` | one per cluster of a scored label type | `street_edge_id`, `label_type`, `severity` (empty = null), `label_count`, `tag_counts` (JSON object, quoted) |

The cluster rows are exactly what `ClusterTable.getClusterScoreRows` streams to `AccessScoreService`, minus the bbox
filter. To refresh the snapshot, run the two `COPY` queries below against a city schema and gzip the output (the spec
only assumes a city with a few hundred audited NoSidewalk streets; its thresholds are loose enough for any city with
that much data):

```sql
COPY (
  SELECT street_edge.street_edge_id,
         COUNT(audit_task.audit_task_id) AS audit_count,
         ROUND(ST_Length(street_edge.geom::geography)::numeric, 1) AS length_meters
  FROM street_edge
  LEFT JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id AND audit_task.completed = TRUE
  GROUP BY street_edge.street_edge_id
  ORDER BY 1
) TO STDOUT WITH CSV HEADER;

COPY (
  SELECT cluster.street_edge_id,
         label_type.label_type,
         cluster.severity,
         label_counts.label_count,
         cluster_tag_counts.tag_counts
  FROM cluster
  INNER JOIN label_type ON cluster.label_type_id = label_type.label_type_id
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
  WHERE label_type.label_type IN ('CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk', 'Crosswalk', 'Signal')
  ORDER BY cluster.street_edge_id, label_type.label_type, cluster.cluster_id
) TO STDOUT WITH CSV HEADER;
```

Project Sidewalk data is CC0; the snapshot carries street ids, cluster summaries, and tag counts only — no user ids,
label ids, or coordinates.
