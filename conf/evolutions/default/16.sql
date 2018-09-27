# --- !Ups
DROP TABLE mission_user;
DROP TABLE mission;

CREATE TABLE mission_type
(
  mission_type_id SERIAL NOT NULL,
  mission_type TEXT NOT NULL,
  PRIMARY KEY (mission_type_id)
);

INSERT INTO "mission_type" ( "mission_type") VALUES ( 'auditOnboarding' );
INSERT INTO "mission_type" ( "mission_type") VALUES ( 'audit' );
INSERT INTO "mission_type" ( "mission_type") VALUES ( 'validationOnboarding' );
INSERT INTO "mission_type" ( "mission_type") VALUES ( 'validation' );

CREATE TABLE mission
(
  mission_id SERIAL NOT NULL,
  mission_type_id INT NOT NULL,
  user_id TEXT NOT NULL,
  mission_start TIMESTAMP NOT NULL,
  mission_end TIMESTAMP NOT NULL,
  completed BOOLEAN NOT NULL,
  pay REAL NOT NULL DEFAULT 0.0,
  paid BOOLEAN NOT NULL,
  distance_meters DOUBLE PRECISION,
  distance_progress DOUBLE PRECISION,
  region_id INT,
  labels_validated INT,
  labels_progress INT,
  PRIMARY KEY (mission_id),
  FOREIGN KEY (mission_type_id) REFERENCES mission_type(mission_type_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk.user(user_id),
  FOREIGN KEY (region_id) REFERENCES region(region_id)
);

TRUNCATE TABLE audit_task_comment;
TRUNCATE TABLE audit_task_interaction;
TRUNCATE TABLE audit_task_environment;
TRUNCATE TABLE audit_task_incomplete;

TRUNCATE TABLE user_attribute_label, label_tag, label;

ALTER TABLE audit_task_comment
  ADD COLUMN audit_task_id INT NOT NULL,
  ADD COLUMN mission_id INT NOT NULL,
  ADD FOREIGN KEY (audit_task_id) REFERENCES audit_task(audit_task_id),
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_interaction
  ADD COLUMN mission_id INT NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_environment
  ADD COLUMN mission_id INT NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE audit_task_incomplete
  ADD COLUMN mission_id INT NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

ALTER TABLE label
  ADD COLUMN mission_id INT NOT NULL,
  ADD FOREIGN KEY (mission_id) REFERENCES mission(mission_id);

# --- !Downs
ALTER TABLE label
  DROP COLUMN mission_id;

ALTER TABLE audit_task_incomplete
  DROP COLUMN mission_id;

ALTER TABLE audit_task_environment
  DROP COLUMN mission_id;

ALTER TABLE audit_task_interaction
  DROP COLUMN mission_id;

ALTER TABLE audit_task_comment
  DROP COLUMN mission_id,
  DROP COLUMN audit_task_id;

DROP TABLE mission;
DROP TABLE mission_type;

CREATE TABLE mission
(
  mission_id SERIAL NOT NULL,
  region_id INT,
  label TEXT NOT NULL,
  level INT NOT NULL,
  deleted BOOLEAN DEFAULT false NOT NULL,
  coverage DOUBLE PRECISION,
  distance DOUBLE PRECISION,
  distance_ft DOUBLE PRECISION,
  distance_mi DOUBLE PRECISION,
  PRIMARY KEY (mission_id)
);

CREATE TABLE mission_user
(
  mission_user_id SERIAL NOT NULL,
  mission_id INT NOT NULL,
  user_id TEXT NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  pay_per_mile REAL NOT NULL DEFAULT 0.0,
  PRIMARY KEY (mission_user_id),
  FOREIGN KEY (mission_id) REFERENCES mission (mission_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk.user (user_id)
);
