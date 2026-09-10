-- 229 created audit_task_interaction_small and left its backfill to be run by hand on the servers ("due to how long
-- the query takes"). DC never got that pass, so do it here, with the same action subset the app maintains
-- (AuditTaskInteractionTable.actionSubsetForSmallTable). Empty on the core sandbox, ~1.8 M rows on the full run
-- (issue #4700).
INSERT INTO audit_task_interaction_small
SELECT * FROM audit_task_interaction
WHERE action IN ('ViewControl_MouseDown', 'LabelingCanvas_MouseDown', 'NextSlideButton_Click', 'PreviousSlideButton_Click')
ON CONFLICT DO NOTHING;
