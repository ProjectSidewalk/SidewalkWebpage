# --- !Ups
DELETE FROM label_tag
  USING tag
  WHERE label_tag.tag_id = tag.tag_id
    AND tag.tag = 'steep';
DELETE FROM tag WHERE tag = 'steep';

INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'not enough landing space' );

# --- !Downs
DELETE FROM tag WHERE tag = 'not enough landing space';
INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'steep' );
