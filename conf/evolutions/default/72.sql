# --- !Ups
INSERT INTO tag VALUES ( 26, 3, 'construction' );
INSERT INTO tag VALUES ( 27, 3, 'sign' );
INSERT INTO tag VALUES ( 28, 4, 'brick' );
INSERT INTO tag VALUES ( 29, 4, 'construction' );

# --- !Downs
DELETE FROM label_tag
WHERE tag_id IN (26, 27, 28, 29);

DELETE FROM tag WHERE tag_id IN (26, 27, 28, 29);
