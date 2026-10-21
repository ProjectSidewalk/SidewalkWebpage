-- 298 deletes every label whose pano id is '' (its "DELETE FROM label CASCADE" is really "DELETE FROM label AS
-- cascade", so dependents must already be gone). DC has 37 such labels from Feb-Jun 2017, and unlike prod at the
-- time they are referenced by old_label_metadata (179 copied every DC label in) and label_history (220), and have
-- label_point rows that would orphan and break 337's FK add. Clear the dependents first; the labels themselves go
-- with mainline's own DELETE, the same fate they met in every other city (issue #4700).
DROP TABLE IF EXISTS dc_migration_dropped_label;
CREATE TABLE dc_migration_dropped_label AS
SELECT label_id, audit_task_id, label_type_id, time_created, 'empty pano id (298)' AS reason FROM label WHERE gsv_panorama_id = '';
DELETE FROM old_label_metadata WHERE label_id IN (SELECT label_id FROM dc_migration_dropped_label);
DELETE FROM label_history WHERE label_id IN (SELECT label_id FROM dc_migration_dropped_label);
DELETE FROM label_point WHERE label_id IN (SELECT label_id FROM dc_migration_dropped_label);

-- 298 also deletes empty-pano interaction rows, parent table before the audit_task_interaction_small copy that
-- references them (on prod the copy held none of these; DC's, filled by 230.pre, does). Same rows 298 removes on
-- its next line, just first.
DELETE FROM audit_task_interaction_small WHERE gsv_panorama_id = '';
