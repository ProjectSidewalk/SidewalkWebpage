# --- !Ups
CREATE TABLE version
(
  version_id TEXT NOT NULL,
  version_start_time TIMESTAMP NOT NULL,
  description TEXT,
  PRIMARY KEY (version_id)
);

# --- !Downs
DROP TABLE version;
