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
    updated_by TEXT NOT NULL,
    version_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version_end TIMESTAMPTZ,
    PRIMARY KEY (label_history_id),
    FOREIGN KEY (label_id) REFERENCES label(label_id),
    FOREIGN KEY (updated_by) REFERENCES sidewalk_user(user_id)
);

# --- !Downs
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

