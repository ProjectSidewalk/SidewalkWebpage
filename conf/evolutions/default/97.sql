# --- !Ups
UPDATE tag SET tag = 'height difference' WHERE tag_id = 34;
INSERT INTO tag VALUES ( 38, 3, 'narrow' );
INSERT INTO tag VALUES ( 39, 4, 'height difference' );

# --- !Downs
UPDATE tag SET tag = 'large step' WHERE tag_id = 34;
DELETE FROM label_tag WHERE tag_id IN (38, 39);
DELETE FROM tag WHERE tag_id IN (38, 39);