# --- !Ups
INSERT INTO tag (label_type_id, tag) VALUES ( 7, 'ends abruptly' );
INSERT INTO tag (label_type_id, tag) VALUES ( 7, 'street has a sidewalk' );
INSERT INTO tag (label_type_id, tag) VALUES ( 7, 'street has no sidewalks' );

# --- !Downs
DELETE FROM tag WHERE label_type_id = 7;
