# --- !Ups
CREATE TABLE tag
(
  tag_id SERIAL NOT NULL,
  label_type_id INT NOT NULL,
  tag TEXT NOT NULL,
  FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id),
  PRIMARY KEY (tag_id)
);

CREATE TABLE label_tag
(
  label_tag_id SERIAL NOT NULL,
  label_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (label_tag_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id),
  FOREIGN KEY (tag_id) REFERENCES tag(tag_id)
);

INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'narrow' );
INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'points into traffic' );
INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'missing friction strip' );
INSERT INTO tag (label_type_id, tag) VALUES ( 1, 'steep' );
INSERT INTO tag (label_type_id, tag) VALUES ( 2, 'alternate route present' );
INSERT INTO tag (label_type_id, tag) VALUES ( 2, 'no alternate route' );
INSERT INTO tag (label_type_id, tag) VALUES ( 2, 'unclear if needed' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, 'trash can' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, 'fire hydrant' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, 'pole' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, 'tree' );
INSERT INTO tag (label_type_id, tag) VALUES ( 3, 'vegetation' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, 'bumpy' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, 'uneven' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, 'cracks' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, 'grass' );
INSERT INTO tag (label_type_id, tag) VALUES ( 4, 'narrow sidewalk' );
INSERT INTO tag (label_type_id, tag) VALUES ( 5, 'missing crosswalk' );
INSERT INTO tag (label_type_id, tag) VALUES ( 5, 'no bus stop access' );

# --- !Downs
DROP TABLE label_tag;

DROP TABLE tag;
