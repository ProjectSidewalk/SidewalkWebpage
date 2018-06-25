
# --- !Ups
DROP TABLE sidewalk_edge_accessibility_feature;

DROP TABLE accessibility_feature;


# --- !Downs
CREATE TABLE accessibility_feature
(
  accessibility_feature_id SERIAL NOT NULL,
  geom public.geometry,
  label_type_id INTEGER,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  PRIMARY KEY (accessibility_feature_id),
  FOREIGN KEY (label_type_id) REFERENCES label_type (label_type_id)
);

CREATE TABLE sidewalk_edge_accessibility_feature
(
  sidewalk_edge_accessibility_feature_id SERIAL NOT NULL,
  sidewalk_edge_id INTEGER,
  accessibility_feature_id INTEGER,
  PRIMARY KEY (accessibility_feature_id),
  FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk_edge (sidewalk_edge_id),
  FOREIGN KEY (accessibility_feature_id) REFERENCES accessibility_feature (accessibility_feature_id)
);
