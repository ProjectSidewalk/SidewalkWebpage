
# --- !Ups
ALTER TABLE turker
  ADD amt_condition_id INT NOT NULL;

ALTER TABLE amt_condition
  ADD volunteer_id TEXT NOT NULL;

CREATE TABLE amt_volunteer_route(
  amt_volunteer_route_id BIGSERIAL,
  volunteer_id TEXT NOT NULL,
  ip_address TEXT,
  route_id INT NOT NULL,
  PRIMARY KEY (amt_volunteer_route_id),
  FOREIGN KEY (route_id) REFERENCES route(route_id)
);

# --- !Downs
DROP TABLE amt_volunteer_route;

ALTER TABLE amt_condition
  DROP volunteer_id;

ALTER TABLE turker
  DROP amt_condition_id;