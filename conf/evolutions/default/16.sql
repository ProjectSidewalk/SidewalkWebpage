# --- !Ups
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
