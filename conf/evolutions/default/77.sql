# --- !Ups
ALTER TABLE audit_task_environment ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

CREATE TABLE validation_task_environment (
     validation_task_environment_id SERIAL NOT NULL,
     mission_id INT,
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
     PRIMARY KEY (validation_task_environment_id),
     FOREIGN KEY (mission_id) REFERENCES mission(mission_id)
);

# --- !Downs
DROP TABLE validation_task_environment;

ALTER TABLE audit_task_environment DROP COLUMN language;
