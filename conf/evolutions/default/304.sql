# --- !Ups
-- Add a new 'bollard' tag in Zurich.
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with)
SELECT 87, label_type_id, 'bollard', NULL
FROM label_type
WHERE label_type.label_type = 'Obstacle';

-- Hide the new tag everywhere but in Zurich.
UPDATE config
SET excluded_tags = excluded_tags || '[
    {
        "label_type": "Obstacle",
        "tag": "bollard"
    }
]'::jsonb
WHERE '$evolutions{{{city-id}}}' NOT IN ('zurich', 'zurich-infra3d', 'staging');

# --- !Downs
-- Remove the new Zurich tag.
UPDATE config
SET excluded_tags = (
    SELECT JSONB_AGG(elem)
    FROM JSONB_ARRAY_ELEMENTS(excluded_tags) elem
    WHERE elem NOT IN ('{
        "label_type": "Obstacle",
        "tag": "bollard"
    }'::jsonb)
);

UPDATE label
SET tags = ARRAY(SELECT elem FROM UNNEST(tags) AS elem WHERE elem NOT IN ('bollard'))
FROM label_type
WHERE label.label_type_id = label_type.label_type_id AND label_type.label_type = 'Obstacle';

UPDATE label_history
SET tags = ARRAY(SELECT elem FROM UNNEST(label_history.tags) AS elem WHERE elem NOT IN ('bollard'))
FROM label
JOIN label_type ON label.label_type_id = label_type.label_type_id
WHERE label_history.label_id = label.label_id AND label_type.label_type = 'Obstacle';

-- Delete entries in the label_history table that no longer represent a change in history after removing the tag.
DELETE
FROM label_history
WHERE label_history_id IN (
    SELECT label_history_id
    FROM (
        SELECT label_history_id,
               label_id,
               severity,
               tags,
               LAG(severity) OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_severity,
               LAG(tags) OVER (PARTITION BY label_id ORDER BY edit_time)     AS prev_tags
        FROM label_history
    ) subquery
    WHERE severity = prev_severity AND tags = prev_tags
);

-- And finally remove the new Zurich tag from the tag table.
DELETE
FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Obstacle' AND tag.tag = 'bollard';
