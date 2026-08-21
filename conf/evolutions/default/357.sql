# --- !Ups
-- #4456: remove the 'Problem' label type (id 8) entirely. It was added in 13.sql as a composite cluster type -- a
-- parallel clustering pass over NoCurbRamp/Obstacle/SurfaceProblem labels -- and never became a placeable label type.
-- Nothing reads its clusters either, so its only effect was to make every label-level consumer subtract it back out.

-- Drop the Problem clusters. `cluster_label` rows go with them via ON DELETE CASCADE (288.sql), and both access paths
-- are indexed by 296.sql: cluster_label_type_id_idx and cluster_label_cluster_id_idx.
--
-- This deletes no label data and triggers no re-clustering: every member label is also in a cluster of its own real
-- type, so ClusteringSessionTable.getRegionsToCluster sees no change.
DELETE FROM cluster
WHERE label_type_id = (SELECT label_type_id FROM label_type WHERE label_type = 'Problem');

-- Strip the type's entry from each session's recorded thresholds. The column is write-only in the app (nothing queries
-- it back), so this is purely so a stored session matches what the clusterer now does.
UPDATE clustering_session
SET thresholds = (
    SELECT COALESCE(jsonb_agg(threshold_entry), '[]'::jsonb)
    FROM jsonb_array_elements(clustering_session.thresholds) AS threshold_entry
    WHERE threshold_entry ->> 'label_type' <> 'Problem'
)
WHERE thresholds @> '[{"label_type": "Problem"}]';

-- Finally the lookup row itself. `label`, `mission`, `tag`, and `cluster` reference label_type, and the first three
-- should never have pointed at Problem (it was never placeable, never a mission target, and carries no tags), so if
-- any city somehow holds such a row this fails loudly with a foreign key violation rather than leaving the type behind.
DELETE FROM label_type WHERE label_type = 'Problem';

# --- !Downs
-- Restore the lookup row at its original id. label_type carries only the id and the name, so that is the whole row.
-- The deleted clusters are not restored: they are derived data, and re-running clustering for a region regenerates
-- everything this evolution dropped.
INSERT INTO label_type (label_type_id, label_type) VALUES (8, 'Problem');
