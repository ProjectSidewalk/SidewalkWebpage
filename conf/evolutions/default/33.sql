# --- !Ups
INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'not enough landing space' );

# --- !Downs
DELETE FROM label_tag
            USING tag
WHERE label_tag.tag_id = tag.tag_id
  AND tag.tag = 'not enough landing space';

DELETE FROM tag WHERE tag = 'not enough landing space';
