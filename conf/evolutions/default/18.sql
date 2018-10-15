# --- !Ups
DROP TABLE street_edge_assignment_count;

# --- !Downs
CREATE TABLE street_edge_assignment_count
(
  street_edge_assignment_count_id SERIAL NOT NULL,
  street_edge_id INT NOT NULL,
  assignment_count INT NOT NULL,
  completion_count INT NOT NULL,
  FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id),
  PRIMARY KEY (street_edge_assignment_count_id)
);
