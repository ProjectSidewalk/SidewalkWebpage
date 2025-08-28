# --- !Ups
ALTER TABLE label DROP COLUMN temporary;

-- Collapse 5-point severity scale to a 3-point scale. This needs to be done in every table that records severity.
UPDATE label
SET severity = CASE WHEN severity IN (1, 2) THEN 1 WHEN severity = 3 THEN 2 WHEN severity IN (4, 5) THEN 3 ELSE severity END
WHERE severity IS NOT NULL;

UPDATE label_history
SET severity = CASE WHEN severity IN (1, 2) THEN 1 WHEN severity = 3 THEN 2 WHEN severity IN (4, 5) THEN 3 ELSE severity END
WHERE severity IS NOT NULL;

UPDATE label_validation
SET old_severity = CASE WHEN old_severity IN (1, 2) THEN 1 WHEN old_severity = 3 THEN 2 WHEN old_severity IN (4, 5) THEN 3 ELSE old_severity END
WHERE old_severity IS NOT NULL;

UPDATE label_validation
SET new_severity = CASE WHEN new_severity IN (1, 2) THEN 1 WHEN new_severity = 3 THEN 2 WHEN new_severity IN (4, 5) THEN 3 ELSE new_severity END
WHERE new_severity IS NOT NULL;

-- Delete entries in the label_history table that no longer represent a change in history after updating severity.
DELETE FROM label_history
WHERE label_history_id IN (
    SELECT label_history_id
    FROM (
        SELECT label_history_id, label_id, severity, tags,
               LAG(severity) OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_severity,
               LAG(tags) OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_tags
        FROM label_history
    ) subquery
    WHERE severity = prev_severity
      AND tags = prev_tags
);

-- Clear out all clustering data so that we can re-generate it with the new severity values.
TRUNCATE TABLE global_clustering_session CASCADE;
TRUNCATE TABLE user_clustering_session CASCADE;

# --- !Downs
UPDATE label_validation
SET new_severity = CASE WHEN new_severity = 1 THEN 1 WHEN new_severity = 2 THEN 3 WHEN new_severity = 3 THEN 5 ELSE new_severity END
WHERE new_severity IS NOT NULL;

UPDATE label_validation
SET old_severity = CASE WHEN old_severity = 1 THEN 1 WHEN old_severity = 2 THEN 3 WHEN old_severity = 3 THEN 5 ELSE old_severity END
WHERE old_severity IS NOT NULL;

UPDATE label_history
SET severity = CASE WHEN severity = 1 THEN 1 WHEN severity = 2 THEN 3 WHEN severity = 3 THEN 5 ELSE severity END
WHERE severity IS NOT NULL;

UPDATE label
SET severity = CASE WHEN severity = 1 THEN 1 WHEN severity = 2 THEN 3 WHEN severity = 3 THEN 5 ELSE severity END
WHERE severity IS NOT NULL;

ALTER TABLE label ADD COLUMN temporary BOOLEAN NOT NULL DEFAULT FALSE
