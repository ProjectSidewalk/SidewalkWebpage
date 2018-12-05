# --- !Ups

UPDATE survey_question
SET survey_question_text = 'How much have you been enjoying using Project Sidewalk?'
WHERE survey_question_id = 1;

UPDATE survey_question
SET survey_question_text = 'How easy or difficult is it to use Project Sidewalk?'
WHERE survey_question_id = 2;

UPDATE survey_question
SET survey_question_text = 'How well do you think you are performing on the labeling tasks?'
WHERE survey_question_id = 3;

UPDATE survey_question
SET survey_question_text = 'Why did you choose to contribute to Project Sidewalk?'
WHERE survey_question_id = 4;

UPDATE survey_question
SET survey_question_text = 'Do you have any feedback, design ideas, or questions?'
WHERE survey_question_id = 5;

# --- !Downs

UPDATE survey_question
SET survey_question_text = 'How much did you enjoy this task?'
WHERE survey_question_id = 1;

UPDATE survey_question
SET survey_question_text = 'How difficult did you find this task?'
WHERE survey_question_id = 2;

UPDATE survey_question
SET survey_question_text = 'How well do you think you did on this task?'
WHERE survey_question_id = 3;

UPDATE survey_question
SET survey_question_text = 'Why did you choose to contribute to Project Sidewalk?'
WHERE survey_question_id = 4;

UPDATE survey_question
SET survey_question_text = 'Do you have any feedback for us?'
WHERE survey_question_id = 5;