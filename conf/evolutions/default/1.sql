
# --- !Ups
CREATE TABLE turker
(
  turker_id TEXT NOT NULL,
  routes_audited INTEGER ARRAY,
  PRIMARY KEY (turker_id)
);

CREATE TABLE mturk_hit
(
  hit_id TEXT NOT NULL,
  cost REAL,
  PRIMARY KEY (hit_id)
);

CREATE TABLE mturk_hit_condition
(
  condition_id BIGSERIAL NOT NULL,
  description text,
  parameters JSON,
  PRIMARY KEY (condition_id)
);

CREATE TABLE mturk_hit_assignment
(
  id BIGSERIAL,
  turker_id TEXT NOT NULL,
  condition_id INTEGER  NOT NULL,
  hit_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  route_id INTEGER,
  PRIMARY KEY (id)
);

# --- !Downs

DROP TABLE turker;
DROP TABLE mturk_hit;
DROP TABLE condition;
DROP TABLE mturk_hit_assignment;
