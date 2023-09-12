# --- !Ups
ALTER TABLE label_validation ADD source TEXT NULL;

UPDATE label_validation SET source = 'ValidateMobile' WHERE is_mobile = TRUE;

UPDATE label_validation
SET source = 'ValidateDesktop'
FROM mission, mission_type
WHERE label_validation.mission_id = mission.mission_id
    AND mission.mission_type_id = mission_type.mission_type_id
    AND mission_type.mission_type = 'validation'
    AND is_mobile = FALSE;

UPDATE label_validation
SET source = 'Old data, unknown source'
WHERE source IS NULL OR
(source IS NOT NULL AND NOT (source = 'ValidateDesktop' or source = 'ValidateMobile'));

ALTER TABLE label_validation ALTER COLUMN source SET NOT NULL;

ALTER TABLE label_validation DROP COLUMN is_mobile;

# --- !Downs
ALTER TABLE label_validation ADD is_mobile BOOLEAN;

UPDATE label_validation SET is_mobile = (source = 'ValidateMobile');

ALTER TABLE label_validation DROP COLUMN source;
