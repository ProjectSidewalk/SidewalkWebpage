
# --- !Ups
CREATE TABLE turker
(
  turker_id TEXT NOT NULL,
  routes_audited TEXT,
  PRIMARY KEY (turker_id)
);

CREATE TABLE amt_condition
(
  amt_condition_id BIGSERIAL NOT NULL,
  description text,
  parameters text NOT NULL,
  PRIMARY KEY (amt_condition_id)
);

CREATE TABLE route
(
  route_id INT NOT NULL,
  region_id INT NOT NULL,
  route_length_mi DOUBLE PRECISION NOT NULL,
  street_count INTEGER NOT NULL,
  mean_street_length_mi DOUBLE PRECISION NOT NULL,
  std_street_length_mi DOUBLE PRECISION,
  PRIMARY KEY (route_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id)
);

CREATE TABLE route_street
(
  route_street_id INT NOT NULL,
  route_id INT NOT NULL,
  region_id INT NOT NULL,
  length_mi DOUBLE PRECISION NOT NULL,
  current_street_edge_id INT NOT NULL,
  next_street_edge_id INT NOT NULL,
  route_start_edge Boolean NOT NULL,
  route_end_edge Boolean NOT NULL,
  PRIMARY KEY (route_street_id),
  FOREIGN KEY (route_id) REFERENCES route(route_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id),
  FOREIGN KEY (current_street_edge_id) REFERENCES street_edge(street_edge_id)
);

CREATE TABLE amt_route_assignment(
  amt_route_assignment_id BIGSERIAL,
  hit_id TEXT NOT NULL,
  route_id INT NOT NULL,
  assignment_count INT DEFAULT 0,
  PRIMARY KEY (amt_route_assignment_id),
  FOREIGN KEY (route_id) REFERENCES route(route_id)
);

ALTER TABLE amt_assignment
  ADD turker_id TEXT NOT NULL,
  ADD condition_id INTEGER NOT NULL,
  ADD route_id INTEGER NOT NULL,
  ADD completed boolean;

ALTER TABLE amt_assignment
  ADD CONSTRAINT amt_assignment_condition_id_fkey
    FOREIGN KEY (condition_id) REFERENCES amt_condition(amt_condition_id),
  ADD CONSTRAINT amt_assignment_route_id_fkey
    FOREIGN KEY (route_id) REFERENCES route(route_id);

CREATE TABLE region_completion
(
  region_id INTEGER NOT NULL,
  total_distance REAL,
  audited_distance REAL,
  PRIMARY KEY (region_id)
);

CREATE TABLE clustering_session
(
  clustering_session_id SERIAL NOT NULL,
  route_id INT NOT NULL,
  clustering_threshold DOUBLE PRECISION NOT NULL,
  time_created timestamp default current_timestamp NOT NULL,
  deleted Boolean NOT NULL,
  PRIMARY KEY (clustering_session_id),
  FOREIGN KEY (route_id) REFERENCES route(route_id)
);

CREATE TABLE clustering_session_cluster
(
  clustering_session_cluster_id SERIAL NOT NULL,
  clustering_session_id INT NOT NULL,
  PRIMARY KEY (clustering_session_cluster_id),
  FOREIGN KEY (clustering_session_id) REFERENCES clustering_session(clustering_session_id)
);

CREATE TABLE clustering_session_label
(
  clustering_session_label_id SERIAL NOT NULL,
  clustering_session_cluster_id INT NOT NULL,
  label_id INT NOT NULL,
  PRIMARY KEY (clustering_session_label_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id),
  FOREIGN KEY (clustering_session_cluster_id) REFERENCES clustering_session_cluster(clustering_session_cluster_id)
);

CREATE TABLE gt_label
(
  gt_label_id SERIAL NOT NULL,
  route_id INT NOT NULL,
  has_label_id Boolean NOT NULL,
  gsv_panorama_id Character Varying( 64 ) NOT NULL,
  label_type_id Integer NOT NULL,
  sv_image_x Integer NOT NULL,
  sv_image_y Integer NOT NULL,
  canvas_x Integer NOT NULL,
  canvas_y Integer NOT NULL,
  heading Double Precision NOT NULL,
  pitch Double Precision NOT NULL,
  zoom Integer NOT NULL,
  canvas_height Integer NOT NULL,
  canvas_width Integer NOT NULL,
  alpha_x Double Precision NOT NULL,
  alpha_y Double Precision NOT NULL,
  lat Double Precision,
  lng Double Precision,
  description Text NOT NULL,
  severity Int NOT NULL,
  temporary_problem Boolean default FALSE NOT NULL,
  PRIMARY KEY (gt_label_id),
  FOREIGN KEY (route_id) REFERENCES route(route_id),
  FOREIGN KEY (label_type_id) REFERENCES label_type(label_type_id)
);

CREATE TABLE gt_existing_label
(
  gt_existing_label_id SERIAL NOT NULL,
  gt_label_id Integer NOT NULL,
  label_id Integer NOT NULL,
  PRIMARY KEY (gt_existing_label_id),
  FOREIGN KEY (gt_label_id) REFERENCES gt_label(gt_label_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id)
);

# --- !Downs

DROP TABLE clustering_session_label;
DROP TABLE clustering_session_cluster;
DROP TABLE clustering_session;

DROP TABLE amt_route_assignment;
ALTER TABLE amt_assignment
  DROP turker_id,
  DROP condition_id,
  DROP completed,
  DROP route_id;

ALTER TABLE amt_assignment
  DROP CONSTRAINT IF EXISTS amt_assignment_turker_id_fkey,
  DROP CONSTRAINT IF EXISTS amt_assignment_condition_id_fkey,
  DROP CONSTRAINT IF EXISTS amt_assignment_route_id_fkey;

DROP TABLE route_street;
DROP TABLE route;
DROP TABLE amt_condition;
DROP TABLE turker;
DROP TABLE region_completion;
