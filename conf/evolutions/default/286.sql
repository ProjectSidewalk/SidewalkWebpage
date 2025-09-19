# --- !Ups
-- Add new label_ai_info table.
CREATE TABLE IF NOT EXISTS label_ai_info (
    label_ai_info_id SERIAL PRIMARY KEY,
    label_id INT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    api_version TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_training_date TIMESTAMP NOT NULL,
    FOREIGN KEY (label_id) REFERENCES label (label_id)
);
ALTER TABLE label_ai_info OWNER TO sidewalk;

-- Set dummy AI user as high quality to avoid the possibility of all its data being filtered out.
UPDATE user_stat SET high_quality_manual = TRUE WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

-- Add a link directly from label_ai_assessment to label_validation. Fill in past data.
ALTER TABLE label_ai_assessment
    ADD COLUMN IF NOT EXISTS label_validation_id INT,
    ADD CONSTRAINT fk_label_validation FOREIGN KEY (label_validation_id) REFERENCES label_validation (label_validation_id);

UPDATE label_ai_assessment
SET label_validation_id = label_validation.label_validation_id
FROM label_validation
WHERE label_ai_assessment.label_id = label_validation.label_id
  AND label_validation.user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

# --- !Downs
ALTER TABLE label_ai_assessment DROP COLUMN IF EXISTS label_validation_id;

UPDATE user_stat SET high_quality_manual = NULL WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

DROP TABLE IF EXISTS label_ai_info;
