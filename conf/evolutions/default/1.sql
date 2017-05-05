
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
  std_street_length_mi DOUBLE PRECISION NOT NULL,
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
  FOREIGN KEY (current_street_edge_id) REFERENCES street_edge(street_edge_id),
  FOREIGN KEY (next_street_edge_id) REFERENCES street_edge(street_edge_id)
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
  ADD CONSTRAINT amt_assignment_turker_id_fkey
    FOREIGN KEY (turker_id) REFERENCES turker(turker_id),
  ADD CONSTRAINT amt_assignment_condition_id_fkey
    FOREIGN KEY (condition_id) REFERENCES amt_condition(amt_condition_id),
  ADD CONSTRAINT amt_assignment_route_id_fkey
    FOREIGN KEY (route_id) REFERENCES route(route_id);


# --- !Downs
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