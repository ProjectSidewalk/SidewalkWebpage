# --- !Ups
UPDATE mission_type SET mission_type_id = 7 WHERE mission_type = 'labelmapValidation';
ALTER TABLE label_history OWNER TO sidewalk;

# --- !Downs
