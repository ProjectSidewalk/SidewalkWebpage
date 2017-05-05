# --- !Ups
CREATE TABLE amt_route_assignment ( 
  amt_route_assignment_id BIGSERIAL, 
  hit_id TEXT NOT NULL, 
  route_id INTEGER, 
  PRIMARY KEY (amt_route_assignment_id),
  FOREIGN KEY (route_id) REFERENCES route(route_id),
 );

ALTER TABLE amt_assignment
  ALTER COLUMN route_id SET NOT NULL,
  ADD CONSTRAINT amt_assignment_turker_id_fkey
    FOREIGN KEY (turker_id) REFERENCES turker(turker_id),
  ADD CONSTRAINT amt_assignment_condition_id_fkey
    FOREIGN KEY (condition_id) REFERENCES amt_condition(amt_condition_id),
  ADD CONSTRAINT amt_assignment_route_id_fkey
    FOREIGN KEY (route_id) REFERENCES route(route_id);

# --- !Downs

DROP TABLE amt_route_assignment;