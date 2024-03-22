# --- !Ups
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

# --- !Downs
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

