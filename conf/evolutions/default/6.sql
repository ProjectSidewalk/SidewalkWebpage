
# --- !Ups
INSERT INTO role (role_id, role) VALUES (4, 'Turker');

ALTER TABLE amt_assignment DROP COLUMN if exists turker_id;
ALTER TABLE amt_assignment DROP COLUMN if exists confirmation_code;
ALTER TABLE amt_assignment DROP COLUMN if exists completed;

ALTER TABLE amt_assignment
  ADD turker_id TEXT NOT NULL,
  ADD confirmation_code TEXT,
  ADD completed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mission_user DROP COLUMN if exists paid;

ALTER TABLE mission_user
  ADD paid BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS survey_category_option
(
  survey_category_option_id SERIAL NOT NULL,
  survey_category_option_text TEXT NOT NULL,
  PRIMARY KEY (survey_category_option_id)
);

CREATE TABLE IF NOT EXISTS survey_question
(
  survey_question_id SERIAL NOT NULL,
  survey_question_text TEXT NOT NULL,
  survey_input_type TEXT NOT NULL,
  survey_category_option_id INT,
  survey_display_rank INT,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  survey_user_role_id INT NOT NULL DEFAULT 1,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (survey_question_id),
  FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id)
);

CREATE TABLE IF NOT EXISTS survey_option(
 survey_option_id INT NOT NULL,
 survey_category_option_id INT NOT NULL,
 survey_option_text TEXT NOT NULL,
 survey_display_rank INT,
 PRIMARY KEY (survey_option_id),
 FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id)
);

INSERT INTO survey_category_option VALUES (1, 'enjoyment');
INSERT INTO survey_category_option VALUES (2, 'difficulty');
INSERT INTO survey_category_option VALUES (3, 'self-efficacy');
INSERT INTO survey_category_option VALUES (4, 'motivation');

INSERT INTO survey_option VALUES (1, 1, 'Very boring', 1);
INSERT INTO survey_option VALUES (2, 1, 'Boring', 2);
INSERT INTO survey_option VALUES (3, 1, 'Neutral', 3);
INSERT INTO survey_option VALUES (4, 1, 'Enjoyable', 4);
INSERT INTO survey_option VALUES (5, 1, 'Very enjoyable', 5);
INSERT INTO survey_option VALUES (6, 2, 'Very difficult', 1);
INSERT INTO survey_option VALUES (7, 2, 'Difficult', 2);
INSERT INTO survey_option VALUES (8, 2, 'Neutral', 3);
INSERT INTO survey_option VALUES (9, 2, 'Easy', 4);
INSERT INTO survey_option VALUES (10, 2, 'Very easy', 5);
INSERT INTO survey_option VALUES (11, 3, 'Poor', 1);
INSERT INTO survey_option VALUES (12, 3, 'Fair', 2);
INSERT INTO survey_option VALUES (13, 3, 'Good', 3);
INSERT INTO survey_option VALUES (14, 3, 'Very Good', 4);
INSERT INTO survey_option VALUES (15, 3, 'Excellent', 5);
INSERT INTO survey_option VALUES (16, 4, 'It''s fun.', 1);
INSERT INTO survey_option VALUES (17, 4, 'For the money.', 2);
INSERT INTO survey_option VALUES (18, 4, 'To help people.', 3);
INSERT INTO survey_option VALUES (19, 4, 'Accessibility is an important cause', 4);

INSERT INTO survey_question VALUES (1, 'How much did you enjoy this task?', 'radio', 1, 1, false, 1,true);
INSERT INTO survey_question VALUES (2, 'How difficult did you find this task?', 'radio', 2, 2, false, 1, true);
INSERT INTO survey_question VALUES (3, 'How well do you think you did on this task?', 'radio', 3, 3, false, 1, true);
INSERT INTO survey_question VALUES (4, 'Why did you choose to contribute to Project Sidewalk?', 'free-text-feedback', NULL, 5, false, 1, true);
INSERT INTO survey_question VALUES (5, 'Do you have any feedback for us?', 'free-text-feedback', NULL, 4, false, 1, false);


create TABLE IF NOT EXISTS user_survey_text_submission
(
  user_survey_text_submission_id SERIAL NOT NULL,
  user_id TEXT NOT NULL,
  survey_question_id INT NOT NULL,
  survey_text_submission TEXT,
  time_submitted TIMESTAMP,
  num_missions_completed INT,
  PRIMARY KEY (user_survey_text_submission_id),
  FOREIGN KEY (user_id) REFERENCES "user"(user_id),
  FOREIGN key (survey_question_id) REFERENCES  survey_question(survey_question_id)
);

CREATE TABLE IF NOT EXISTS user_survey_option_submission
(
  user_survey_option_submission_id SERIAL NOT NULL,
  user_id TEXT NOT NULL,
  survey_question_id INT NOT NULL,
  survey_option_id INT,
  time_submitted TIMESTAMP,
  num_missions_completed INT,
  PRIMARY KEY (user_survey_option_submission_id),
  FOREIGN KEY (user_id) REFERENCES "user"(user_id),
  FOREIGN key (survey_question_id) REFERENCES  survey_question(survey_question_id)
);

# --- !Downs

ALTER TABLE mission_user
  DROP paid;

ALTER TABLE amt_assignment
  DROP turker_id,
  DROP confirmation_code,
  DROP completed;

DELETE FROM role WHERE (role_id = 4 AND role = 'Turker');
DELETE FROM user_role WHERE role_id = 4;

ALTER TABLE user_survey_option_submission
  DROP CONSTRAINT IF EXISTS user_survey_option_submission_user_id_fkey,
  DROP CONSTRAINT IF EXISTS user_survey_option_submission_survey_question_id_fkey;

ALTER TABLE user_survey_text_submission
  DROP CONSTRAINT IF EXISTS user_survey_text_submission_user_id_fkey,
  DROP CONSTRAINT IF EXISTS user_survey_text_submission_survey_question_id_fkey;

ALTER TABLE survey_option
  DROP CONSTRAINT IF EXISTS survey_option_survey_category_option_id_fkey;

ALTER TABLE survey_question
  DROP CONSTRAINT IF EXISTS survey_question_survey_category_option_id_fkey;


DROP TABLE user_survey_option_submission;
DROP TABLE user_survey_text_submission;

DROP TABLE survey_option;
DROP TABLE survey_question;
DROP TABLE survey_category_option;
