# --- !Ups
ALTER TABLE survey_question RENAME COLUMN survey_question_text TO survey_question_text_id;

UPDATE survey_question SET survey_question_text_id = 'enjoyment' WHERE survey_question_id = 1;
UPDATE survey_question SET survey_question_text_id = 'difficulty' WHERE survey_question_id = 2;
UPDATE survey_question SET survey_question_text_id = 'performance' WHERE survey_question_id = 3;
UPDATE survey_question SET survey_question_text_id = 'rationale' WHERE survey_question_id = 4;
UPDATE survey_question SET survey_question_text_id = 'feedback' WHERE survey_question_id = 5;

DELETE FROM survey_option WHERE survey_category_option_id = 4;

ALTER TABLE survey_option DROP CONSTRAINT IF EXISTS survey_option_survey_category_option_id_fkey;
ALTER TABLE survey_option RENAME COLUMN survey_category_option_id TO survey_question_id;
ALTER TABLE survey_option ADD CONSTRAINT survey_option_survey_question_id_fkey FOREIGN KEY (survey_question_id) REFERENCES survey_question(survey_question_id);

ALTER TABLE survey_question DROP CONSTRAINT IF EXISTS survey_question_survey_category_option_id_fkey;
ALTER TABLE survey_question DROP COLUMN survey_category_option_id;

DROP TABLE survey_category_option;

ALTER TABLE survey_option DROP COLUMN survey_option_text;

# --- !Downs
ALTER TABLE survey_option ADD COLUMN survey_option_text TEXT;
UPDATE survey_option SET survey_option_text = 'Very boring' WHERE survey_option_id = 1;
UPDATE survey_option SET survey_option_text = 'Boring' WHERE survey_option_id = 2;
UPDATE survey_option SET survey_option_text = 'Neutral' WHERE survey_option_id = 3;
UPDATE survey_option SET survey_option_text = 'Enjoyable' WHERE survey_option_id = 4;
UPDATE survey_option SET survey_option_text = 'Very enjoyable' WHERE survey_option_id = 5;
UPDATE survey_option SET survey_option_text = 'Very difficult' WHERE survey_option_id = 6;
UPDATE survey_option SET survey_option_text = 'Difficult' WHERE survey_option_id = 7;
UPDATE survey_option SET survey_option_text = 'Neutral' WHERE survey_option_id = 8;
UPDATE survey_option SET survey_option_text = 'Easy' WHERE survey_option_id = 9;
UPDATE survey_option SET survey_option_text = 'Very easy' WHERE survey_option_id = 10;
UPDATE survey_option SET survey_option_text = 'Poor' WHERE survey_option_id = 11;
UPDATE survey_option SET survey_option_text = 'Fair' WHERE survey_option_id = 12;
UPDATE survey_option SET survey_option_text = 'Good' WHERE survey_option_id = 13;
UPDATE survey_option SET survey_option_text = 'Very Good' WHERE survey_option_id = 14;
UPDATE survey_option SET survey_option_text = 'Excellent' WHERE survey_option_id = 15;
ALTER TABLE survey_option ALTER COLUMN survey_option_text SET NOT NULL;

CREATE TABLE survey_category_option
(
    survey_category_option_id SERIAL NOT NULL,
    survey_category_option_text TEXT NOT NULL,
    PRIMARY KEY (survey_category_option_id)
);
INSERT INTO survey_category_option VALUES (1, 'enjoyment');
INSERT INTO survey_category_option VALUES (2, 'difficulty');
INSERT INTO survey_category_option VALUES (3, 'self-efficacy');
INSERT INTO survey_category_option VALUES (4, 'motivation');

ALTER TABLE survey_question ADD COLUMN survey_category_option_id INT;
ALTER TABLE survey_question ADD CONSTRAINT survey_question_survey_category_option_id_fkey FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id);
UPDATE survey_question SET survey_category_option_id = survey_question_id WHERE survey_question_id IN (1, 2, 3);

ALTER TABLE survey_option DROP CONSTRAINT IF EXISTS survey_option_survey_question_id_fkey;
ALTER TABLE survey_option RENAME COLUMN survey_question_id TO survey_category_option_id;
ALTER TABLE survey_option ADD CONSTRAINT survey_option_survey_category_option_id_fkey FOREIGN KEY (survey_category_option_id) REFERENCES survey_category_option(survey_category_option_id);

INSERT INTO survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (16, 4, 'It''s fun.', 1);
INSERT INTO survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (17, 4, 'For the money.', 2);
INSERT INTO survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (18, 4, 'To help people.', 3);
INSERT INTO survey_option (survey_option_id, survey_category_option_id, survey_option_text, survey_display_rank) VALUES (19, 4, 'Accessibility is an important cause', 4);

UPDATE survey_question SET survey_question_text_id = 'Do you have any feedback, design ideas, or questions?' WHERE survey_question_id = 5;
UPDATE survey_question SET survey_question_text_id = 'Why did you choose to contribute to Project Sidewalk?' WHERE survey_question_id = 4;
UPDATE survey_question SET survey_question_text_id = 'How well do you think you are performing on the labeling tasks?' WHERE survey_question_id = 3;
UPDATE survey_question SET survey_question_text_id = 'How easy or difficult is it to use Project Sidewalk?' WHERE survey_question_id = 2;
UPDATE survey_question SET survey_question_text_id = 'How much have you been enjoying using Project Sidewalk?' WHERE survey_question_id = 1;

ALTER TABLE survey_question RENAME COLUMN survey_question_text_id TO survey_question_text;
