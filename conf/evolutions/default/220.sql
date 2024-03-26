# --- !Ups
-- Move tags from label_tag table to a column in the label table.
ALTER TABLE label ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

UPDATE label
SET tags = tags_subquery.tags_array
FROM (
    SELECT label.label_id, array_agg(tag.tag) AS tags_array
    FROM label
    INNER JOIN label_tag ON label.label_id = label_tag.label_id
    INNER JOIN tag ON label_tag.tag_id = tag.tag_id
    GROUP BY label.label_id
) AS tags_subquery
WHERE label.label_id = tags_subquery.label_id;

DROP TABLE label_tag;

-- Add a label_history table to record changes to the label table.
CREATE TABLE label_history (
    label_history_id SERIAL NOT NULL,
    label_id INT NOT NULL,
    severity INT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    edited_by TEXT NOT NULL,
    edit_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (label_history_id),
    FOREIGN KEY (label_id) REFERENCES label(label_id),
    FOREIGN KEY (edited_by) REFERENCES sidewalk_user(user_id)
);

-- Fill in label_history table with an initial entry for every label.
INSERT INTO label_history (label_id, severity, tags, edited_by, edit_time)
SELECT label.label_id, label.severity, label.tags, audit_task.user_id, label.time_created
FROM label
INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id;

-- Add columns to the label_validation table to record changes to severity and tags made through Validate.
ALTER TABLE label_validation
    ADD COLUMN old_severity INT,
    ADD COLUMN new_severity INT,
    ADD COLUMN old_tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN new_tags TEXT[] NOT NULL DEFAULT '{}';

-- Fill in the newly added columns for all old entries (old = new bc this is a new feature).
UPDATE label_validation
SET old_severity = severity,
    new_severity = severity,
    old_tags = tags,
    new_tags = tags
FROM label
WHERE label_validation.label_id = label.label_id;

# --- !Downs
ALTER TABLE label_validation
    DROP COLUMN old_severity,
    DROP COLUMN new_severity,
    DROP COLUMN old_tags,
    DROP COLUMN new_tags;

DROP TABLE label_history;

CREATE TABLE label_tag (
    label_tag_id SERIAL NOT NULL,
    label_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (label_tag_id),
    FOREIGN KEY (label_id) REFERENCES label(label_id),
    FOREIGN KEY (tag_id) REFERENCES tag(tag_id)
);

INSERT INTO label_tag (label_id, tag_id)
SELECT label.label_id, tag.tag_id
FROM label
CROSS JOIN tag
WHERE tag.tag = ANY(label.tags);

ALTER TABLE label DROP COLUMN tags;

