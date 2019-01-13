# --- !Ups
CREATE TABLE validation_options (
  validation_option_id INT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (validation_option_id)
);

CREATE TABLE validation_task_interaction (
  validation_task_interaction_id SERIAL,
  action TEXT NOT NULL,
  gsv_panorama_id VARCHAR(64),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  pitch DOUBLE PRECISION,
  zoom DOUBLE PRECISION,
  note TEXT,
  timestamp TIMESTAMPTZ,
  mission_id INT
);

CREATE TABLE label_validation (
  label_validation_id SERIAL,
  label_id INT NOT NULL,
  validation_result INT NOT NULL,
  user_id TEXT NOT NULL,
  mission_id INT NOT NULL,
  canvas_x INT NOT NULL,
  canvas_y INT NOT NULL,
  heading DOUBLE PRECISION NOT NULL,
  pitch DOUBLE PRECISION NOT NULL,
  zoom DOUBLE PRECISION NOT NULL,
  canvas_height INT NOT NULL,
  canvas_width INT NOT NULL,
  start_timestamp TIMESTAMPTZ,
  end_timestamp TIMESTAMPTZ,
  PRIMARY KEY (label_validation_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id),
  FOREIGN KEY (validation_result) REFERENCES validation_options(validation_option_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id),
  FOREIGN KEY (mission_id) REFERENCES mission(mission_id)
);

CREATE TABLE validation_task_comment (
  validation_task_comment_id SERIAL,
  mission_id INT NOT NULL,
  label_id INT NOT NULL,
  user_id TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  gsv_panorama_id TEXT NOT NULL,
  heading DOUBLE PRECISION NOT NULL,
  pitch DOUBLE PRECISION NOT NULL,
  zoom INT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ,
  comment TEXT NOT NULL,
  PRIMARY KEY (validation_task_comment_id),
  FOREIGN KEY (mission_id) REFERENCES mission(mission_id),
  FOREIGN KEY (label_id) REFERENCES label(label_id),
  FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id)
);

INSERT INTO validation_options (validation_option_id, text) VALUES (1, 'agree');
INSERT INTO validation_options (validation_option_id, text) VALUES (2, 'disagree');
INSERT INTO validation_options (validation_option_id, text) VALUES (3, 'unclear');

ALTER TABLE gsv_data
  ADD COLUMN expired BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN last_viewed TIMESTAMPTZ;

# --- !Downs
DROP TABLE label_validation;
DROP TABLE validation_options;
DROP TABLE validation_task_interaction;
DROP TABLE validation_task_comment;

ALTER TABLE gsv_data
  DROP COLUMN expired,
  DROP COLUMN last_viewed;