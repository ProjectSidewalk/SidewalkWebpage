# --- !Ups
SELECT setval('mission_type_mission_type_id_seq', (SELECT MAX(mission_type_id) from mission_type));
INSERT INTO mission_type (mission_type) VALUES ('labelmapValidation');

# --- !Downs
UPDATE mission
SET mission_type_id = 4, completed = TRUE, labels_progress = 1
WHERE mission_type_id = 7;

DELETE FROM mission_type WHERE mission_type = 'labelmapValidation';
