
# --- !Ups
CREATE TABLE region_completion
(
  region_id INTEGER NOT NULL,
  total_distance REAL,
  audited_distance REAL,
  PRIMARY KEY (region_id)
);

# --- !Downs

DROP TABLE region_completion;
