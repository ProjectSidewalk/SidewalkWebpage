# --- !Ups
-- Remove severity for NoSidewalk (id 7) and Signal (id 10) label types in all tables.
UPDATE label SET severity = NULL WHERE label_type_id IN (7, 10);

UPDATE label_validation
SET old_severity = NULL, new_severity = NULL
FROM label
WHERE label_validation.label_id = label.label_id
    AND label_type_id IN (7, 10);

UPDATE label_history
SET severity = NULL
FROM label
WHERE label_history.label_id = label.label_id
  AND label_type_id IN (7, 10);

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

# --- !Downs
-- Can't restore data automatically. Saving severity ratings in a CSV that we can restore from manually if needed.
