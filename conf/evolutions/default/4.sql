
# --- !Ups
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
  description Text,
  severity Int,
  temporary_problem Boolean default FALSE,
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

INSERT INTO mission (region_id, label, level, deleted, coverage, distance, distance_ft, distance_mi)
SELECT region_id, label, level, deleted, coverage, distance/2, distance_ft/2, distance_mi/2
FROM mission
WHERE deleted = 'f' and distance_ft = 1000 and label = 'distance-mission';

INSERT INTO mission (region_id, label, level, deleted, coverage, distance, distance_ft, distance_mi)
SELECT region_id, label, level, deleted, coverage/2, distance, distance_ft, distance_mi
FROM (
  SELECT m1.region_id, m1.label, m1.level, m1.deleted, m2.coverage, m1.distance, m1.distance_ft, m1.distance_mi
  FROM mission m1 INNER JOIN mission m2 ON m1.region_id = m2.region_id
  WHERE m1.deleted = 'f' AND m2.deleted = 'f' AND m1.distance_ft = 1000 AND m2.distance_ft = 2000 AND m1.label = 'distance-mission' AND m2.label = 'distance-mission'
) m3;

# --- !Downs

DROP TABLE gt_existing_label;
DROP TABLE gt_label;

DROP TABLE clustering_session_label;
DROP TABLE clustering_session_cluster;
DROP TABLE clustering_session;

DELETE FROM mission
WHERE deleted = 'f' AND distance_ft = 500 AND label = 'distance-mission';

DELETE FROM mission
WHERE deleted = 'f' AND distance_ft = 1000 AND coverage IS NOT NULL AND label = 'distance-mission'
