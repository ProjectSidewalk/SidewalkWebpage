# --- !Ups
-- Try updating time_created using audit_task_interaction table first, since it will be more accurate.
UPDATE label
SET time_created = new_timestamp
FROM (
    SELECT label.label_id,
           MIN(audit_task_interaction.timestamp) AS new_timestamp
    FROM label
    INNER JOIN audit_task_interaction ON label.audit_task_id = audit_task_interaction.audit_task_id
        AND label.temporary_label_id = audit_task_interaction.temporary_label_id
    WHERE label.time_created IS NULL
    GROUP BY label.label_id
) AS new_timestamps
WHERE label.label_id = new_timestamps.label_id
    AND label.time_created IS NULL;

-- If we don't find matching interactions, just use task_start from the audit_task table as an imperfect backup.
UPDATE label
SET time_created = task_start
FROM audit_task
WHERE label.audit_task_id = audit_task.audit_task_id
  AND label.time_created IS NULL;

# --- !Downs
