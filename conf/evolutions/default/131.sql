# --- !Ups
DELETE FROM label_tag
USING tag, label_type
WHERE label_tag.tag_id = tag.tag_id
    AND tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag = 'paint not fading';

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND label_type.label_type = 'Crosswalk'
    AND tag.tag = 'paint not fading';

# --- !Downs
SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from "tag"));

INSERT INTO tag (label_type_id, tag) SELECT label_type_id, 'paint not fading' FROM label_type WHERE label_type.label_type = 'Crosswalk';
