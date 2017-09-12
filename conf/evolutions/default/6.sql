# --- !Ups
INSERT INTO role (role_id, role) VALUES (4, 'Turker');

ALTER TABLE amt_assignment
  ADD turker_id TEXT NOT NULL,
  ADD confirmation_code TEXT,
  ADD completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mission_user
  ADD paid BOOLEAN NOT NULL DEFAULT FALSE;

# --- !Downs

ALTER TABLE mission_user
  DROP paid;

ALTER TABLE amt_assignment
  DROP turker_id,
  DROP confirmation_code,
  DROP completed;

DELETE FROM role WHERE (role_id = 4 AND role = 'Turker');
DELETE FROM user_role WHERE role_id = 4;