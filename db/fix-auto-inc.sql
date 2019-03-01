SELECT setval('label_type_label_type_id_seq', (SELECT MAX(label_type_id) from sidewalk.label_type));
SELECT setval('mission_type_mission_type_id_seq', (SELECT MAX(mission_type_id) from sidewalk.mission_type));
SELECT setval('role_role_id_seq', (SELECT MAX(role_id) from sidewalk.role));
SELECT setval('survey_category_option_survey_category_option_id_seq', (SELECT MAX(survey_category_option_id) from sidewalk.survey_category_option));
SELECT setval('survey_question_survey_question_id_seq', (SELECT MAX(survey_question_id) from sidewalk.survey_question));
SELECT setval('tag_tag_id_seq', (SELECT MAX(tag_id) from sidewalk.tag));

