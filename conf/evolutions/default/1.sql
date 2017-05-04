
# --- !Ups
CREATE TABLE turker
(
  turker_id TEXT NOT NULL,
  routes_audited INTEGER ARRAY,
  PRIMARY KEY (turker_id)
);

CREATE TABLE amt_condition
(
  condition_id BIGSERIAL NOT NULL,
  description text,
  parameters JSON,
  PRIMARY KEY (condition_id)
);


ALTER TABLE amt_assignment
  ADD turker_id TEXT NOT NULL,
  ADD condition_id INTEGER NOT NULL,
  ADD route_id INTEGER,
  ADD completed boolean;


# --- !Downs

DROP TABLE turker;
DROP TABLE amt_condition;
ALTER TABLE amt_assignment
  DROP turker_id,
  DROP condition_id,
  DROP completed,
  DROP route_id;