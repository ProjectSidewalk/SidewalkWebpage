# --- !Ups
INSERT INTO mission_type (mission_type) VALUES ('labelmapValidation');

# --- !Downs
UPDATE mission
SET mission_type_id = 4, completed = TRUE, labels_validated = 1, labels_progress = 1
WHERE mission_type_id = 7;

DELETE FROM mission_type WHERE mission_type = 'labelmapValidation';
