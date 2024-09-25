# --- !Ups
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 71, label_type_id, 'debris', NULL FROM label_type WHERE label_type.label_type = 'SurfaceProblem';

# --- !Downs
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "debris"', '');

UPDATE label_history SET tags = array_remove(tags, 'debris');

-- Delete entries in the label_history table that no longer represent a change in history after removing the tag.
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

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'SurfaceProblem'
    AND tag.tag = 'debris';
