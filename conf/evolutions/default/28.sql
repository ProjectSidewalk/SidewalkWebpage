# --- !Ups

INSERT INTO tag (label_type_id, tag) VALUES ( 7, 'sidewalk ends abruptly' );
INSERT INTO tag (label_type_id, tag) VALUES ( 7, 'sidewalk on other side of the street' );
INSERT INTO tag (label_type_id, tag) VALUES ( 7, 'no sidewalk on either side of the street' );

# --- !Downs

DELETE FROM tag WHERE label_type_id = 7;