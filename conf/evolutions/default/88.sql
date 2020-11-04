# --- !Ups
UPDATE tag SET tag = 'uneven/slanted' WHERE tag_id = 14;
INSERT INTO tag VALUES ( 30, 1, 'not level with street' );
INSERT INTO tag VALUES ( 31, 3, 'garage entrance' );
INSERT INTO tag VALUES ( 32, 3, 'stairs' );
INSERT INTO tag VALUES ( 33, 3, 'street vendor' );
INSERT INTO tag VALUES ( 34, 3, 'large step' );
INSERT INTO tag VALUES ( 35, 4, 'very broken' );
INSERT INTO tag VALUES ( 36, 7, 'gravel/dirt road' );
INSERT INTO tag VALUES ( 37, 7, 'shared pedestrian/car space' );

# --- !Downs
UPDATE tag SET tag = 'uneven' WHERE tag_id = 14;
DELETE FROM label_tag WHERE tag_id IN (30, 31, 32, 33, 34, 35, 36, 37);
DELETE FROM tag WHERE tag_id IN (30, 31, 32, 33, 34, 35, 36, 37);
