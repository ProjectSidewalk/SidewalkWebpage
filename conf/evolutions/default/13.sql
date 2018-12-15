# --- !Ups
DROP TABLE sidewalk_edge_accessibility_feature;

DROP TABLE accessibility_feature;

INSERT INTO label_type VALUES (8, 'Problem', 'Composite type: represents cluster of NoCurbRamp, Obstacle, and/or SurfaceProblem labels');

CREATE TABLE IF NOT EXISTS user_clustering_session
(
  user_clustering_session_id SERIAL NOT NULL,
  is_anonymous BOOLEAN NOT NULL,
  user_id TEXT,
  ip_address TEXT,
  time_created timestamp default current_timestamp NOT NULL,
  PRIMARY KEY (user_clustering_session_id),
  FOREIGN KEY (user_id) REFERENCES "user" (user_id)
);

CREATE TABLE IF NOT EXISTS user_attribute
(
  user_attribute_id SERIAL NOT NULL,
  user_clustering_session_id INT NOT NULL,
  clustering_threshold DOUBLE PRECISION NOT NULL,
  label_type_id INT NOT NULL,
  region_id INT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  severity INT,
  temporary BOOLEAN NOT NULL,
  PRIMARY KEY (user_attribute_id),
  FOREIGN KEY (user_clustering_session_id) REFERENCES user_clustering_session(user_clustering_session_id),
  FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE IF NOT EXISTS user_attribute_label
(
  user_attribute_label_id SERIAL NOT NULL,
  user_attribute_id INT NOT NULL,
  label_id INT NOT NULL,
  PRIMARY KEY (user_attribute_label_id),
  FOREIGN KEY (user_attribute_id) REFERENCES user_attribute(user_attribute_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id)
);

CREATE TABLE IF NOT EXISTS global_clustering_session
(
  global_clustering_session_id SERIAL NOT NULL,
  region_id INT NOT NULL,
  time_created timestamp default current_timestamp NOT NULL,
  PRIMARY KEY (global_clustering_session_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE IF NOT EXISTS global_attribute
(
  global_attribute_id SERIAL NOT NULL,
  global_clustering_session_id INT NOT NULL,
  clustering_threshold DOUBLE PRECISION NOT NULL,
  label_type_id INT NOT NULL,
  region_id INT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  severity INT,
  temporary BOOLEAN NOT NULL,
  PRIMARY KEY (global_attribute_id),
  FOREIGN KEY (global_clustering_session_id) REFERENCES global_clustering_session(global_clustering_session_id),
  FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE IF NOT EXISTS global_attribute_user_attribute
(
  global_attribute_user_attribute_id SERIAL NOT NULL,
  global_attribute_id INT NOT NULL,
  user_attribute_id INT NOT NULL,
  PRIMARY KEY (global_attribute_user_attribute_id),
  FOREIGN KEY (user_attribute_id) REFERENCES user_attribute(user_attribute_id),
  FOREIGN KEY (global_attribute_id) REFERENCES global_attribute(global_attribute_id)
);


# --- !Downs
DROP TABLE global_attribute_user_attribute;

DROP TABLE global_attribute;

DROP TABLE global_clustering_session;

DROP TABLE user_attribute_label;

DROP TABLE user_attribute;

DROP TABLE user_clustering_session;

DELETE FROM label_type WHERE label_type.label_type = 'Problem';

CREATE TABLE IF NOT EXISTS accessibility_feature
(
  accessibility_feature_id SERIAL NOT NULL,
  geom public.geometry,
  label_type_id INTEGER,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  PRIMARY KEY (accessibility_feature_id),
  FOREIGN KEY (label_type_id) REFERENCES label_type (label_type_id)
);

CREATE TABLE IF NOT EXISTS sidewalk_edge_accessibility_feature
(
  sidewalk_edge_accessibility_feature_id SERIAL NOT NULL,
  sidewalk_edge_id INTEGER,
  accessibility_feature_id INTEGER,
  PRIMARY KEY (accessibility_feature_id),
  FOREIGN KEY (sidewalk_edge_id) REFERENCES sidewalk_edge (sidewalk_edge_id),
  FOREIGN KEY (accessibility_feature_id) REFERENCES accessibility_feature (accessibility_feature_id)
);
