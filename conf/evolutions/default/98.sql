# --- !Ups
CREATE TABLE gallery_task_interaction (
  gallery_task_interaction_id SERIAL NOT NULL,
  action TEXT NOT NULL,
  pano_id VARCHAR(64),
  note TEXT,
  timestamp TIMESTAMPTZ NOT NULL
);

CREATE TABLE gallery_task_environment (
     gallery_task_environment_id SERIAL NOT NULL,
     browser TEXT,
     browser_version TEXT,
     browser_width INT,
     browser_height INT,
     avail_width INT,
     avail_height INT,
     screen_width INT,
     screen_height INT,
     operating_system TEXT,
     ip_address TEXT,
     language TEXT NOT NULL,
     PRIMARY KEY (gallery_task_environment_id)
);

# --- !Downs
DROP TABLE gallery_task_interaction;
DROP TABLE gallery_task_environment;
