# --- !Ups
CREATE TABLE street_edge_priority
(
 street_edge_priority_id SERIAL NOT NULL,
 street_edge_id INT NOT NULL,
 priority DOUBLE PRECISION NOT NULL DEFAULT 0.0,
 PRIMARY KEY (street_edge_priority_id),
 FOREIGN KEY (street_edge_id) REFERENCES street_edge(street_edge_id)
);

INSERT INTO street_edge_priority (street_edge_id)
SELECT DISTINCT(street_edge_id) FROM street_edge_region;

# --- !Downs
DROP TABLE street_edge_priority;
