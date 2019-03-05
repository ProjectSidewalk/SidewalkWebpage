# --- !Ups
INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'not enough landing space' );

# --- !Downs
DELETE FROM tag WHERE tag = 'not enough landing space';
