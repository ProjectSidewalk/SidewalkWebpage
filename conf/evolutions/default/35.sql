# --- !Ups
INSERT INTO tag (label_type_id, tag) VALUES ( 3, 'parked car' );

# --- !Downs
DELETE FROM label_tag
            USING tag
WHERE label_tag.tag_id = tag.tag_id
  AND tag.tag = 'parked car';

DELETE FROM tag WHERE tag = 'parked car';
