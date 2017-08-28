
# --- !Ups
CREATE TABLE survey_category_option
(
  survey_category_option_id SERIAL NOT NULL,
  survey_category_option_text TEXT NOT NULL,
  PRIMARY KEY (survey_category_option_id)
);

CREATE TABLE survey_question
(
  survey_question_id SERIAL NOT NULL,
  survey_question_text TEXT NOT NULL,
  survey_input_type TEXT NOT NULL,
  survey_category_option_id INT,
  survey_display_rank INT,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (survey_question_id),
  FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id)
);

CREATE TABLE survey_option(
 survey_option_id INT NOT NULL,
 survey_category_option_id INT NOT NULL,
 survey_option_text TEXT NOT NULL,
 survey_display_rank INT,
 PRIMARY KEY (survey_option_id),
 FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id)
);

create TABLE user_survey_text_submission
(
  user_survey_text_submission_id SERIAL NOT NULL,
  user_id TEXT NOT NULL,
  survey_question_id INT NOT NULL,
  survey_text_submission TEXT,
  time_submitted TIMESTAMP,
  PRIMARY KEY (user_survey_text_submission_id),
  FOREIGN KEY (user_id) REFERENCES "user"(user_id),
  FOREIGN key (survey_question_id) REFERENCES  survey_question(survey_question_id)
);

CREATE TABLE user_survey_option_submission
(
  user_survey_option_submission_id SERIAL NOT NULL,
  user_id TEXT NOT NULL,
  survey_question_id INT NOT NULL,
  survey_option_id INT,
  time_submitted TIMESTAMP,
  PRIMARY KEY (user_survey_option_submission_id),
  FOREIGN KEY (user_id) REFERENCES "user"(user_id),
  FOREIGN key (survey_question_id) REFERENCES  survey_question(survey_question_id)
);

# --- !Downs
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