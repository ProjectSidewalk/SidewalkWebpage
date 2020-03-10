# --- !Ups
INSERT INTO gsv_data VALUES ( 'tutorial', 13312, 6656, 512, 512, '2014-05', 1, '', FALSE, now() );

# --- !Downs
DELETE FROM gsv_data WHERE gsv_panorama_id = 'tutorial';
