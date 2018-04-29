
# --- !Ups
CREATE TABLE user_clustering_session
(
  user_clustering_session_id SERIAL NOT NULL,
  is_anonymous BOOLEAN NOT NULL,
  user_id TEXT,
  ip_address TEXT,
  time_created timestamp default current_timestamp NOT NULL,
  PRIMARY KEY (user_clustering_session_id),
  FOREIGN KEY (user_id) REFERENCES "user" (user_id)
);

CREATE TABLE user_attribute
(
  user_attribute_id SERIAL NOT NULL,
  user_clustering_session_id INT NOT NULL,
  clustering_threshold DOUBLE PRECISION NOT NULL,
  label_type_id INT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  severity INT,
  temporary BOOLEAN NOT NULL,
  PRIMARY KEY (user_attribute_id),
  FOREIGN KEY (user_clustering_session_id) REFERENCES user_clustering_session(user_clustering_session_id),
  FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id)
);

CREATE TABLE user_attribute_label
(
  user_attribute_label_id SERIAL NOT NULL,
  user_attribute_id INT NOT NULL,
  label_id INT NOT NULL,
  PRIMARY KEY (user_attribute_label_id),
  FOREIGN KEY (user_attribute_id) REFERENCES user_attribute(user_attribute_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id)
);

CREATE TABLE global_clustering_session
(
  global_clustering_session_id SERIAL NOT NULL,
  region_id INT NOT NULL,
  time_created timestamp default current_timestamp NOT NULL,
  PRIMARY KEY (global_clustering_session_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE global_attribute
(
  global_attribute_id SERIAL NOT NULL,
  global_clustering_session_id INT NOT NULL,
  clustering_threshold DOUBLE PRECISION NOT NULL,
  label_type_id INT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  severity INT,
  temporary BOOLEAN NOT NULL,
  PRIMARY KEY (global_attribute_id),
  FOREIGN KEY (global_clustering_session_id) REFERENCES global_clustering_session(global_clustering_session_id),
  FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id)
);

CREATE TABLE global_attribute_user_attribute
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
