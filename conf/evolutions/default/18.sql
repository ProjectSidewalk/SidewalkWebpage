# --- !Ups
CREATE TABLE validation_options (
  validation_option_id INT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (validation_option_id)
);

CREATE TABLE validation_task_interaction (
  validation_task_interaction_id SERIAL,
  validation_task_id INT NOT NULL,
  action TEXT NOT NULL,
  gsv_panorama_id VARCHAR(64),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  pitch DOUBLE PRECISION,
  zoom DOUBLE PRECISION,
  note TEXT,
  timestamp TIMESTAMP,
  mission_id INT
);

CREATE TABLE label_validation (
  validation_task_id SERIAL,
  label_id INT NOT NULL,
  validation_result INT NOT NULL,
  user_id TEXT NOT NULL,
  mission_id INT NOT NULL,
  start_timestamp TIMESTAMP,
  end_timestamp TIMESTAMP,
  PRIMARY KEY (validation_task_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id),
  FOREIGN KEY (validation_result) REFERENCES validation_options(validation_option_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk.user(user_id),
  FOREIGN KEY (mission_id) REFERENCES mission(mission_id)
);

INSERT INTO validation_options (validation_option_id, text) VALUES (1, 'agree');
INSERT INTO validation_options (validation_option_id, text) VALUES (2, 'disagree');
INSERT INTO validation_options (validation_option_id, text) VALUES (3, 'unclear');

ALTER TABLE gsv_data
  ADD COLUMN expired BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN last_viewed TIMESTAMP;


# --- !Downs
DROP TABLE label_validation;
DROP TABLE validation_options;
DROP TABLE validation_task_interaction;

ALTER TABLE gsv_data
  DROP COLUMN expired,
  DROP COLUMN last_viewed;