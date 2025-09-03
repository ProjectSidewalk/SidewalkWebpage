# --- !Ups
-- Add new label_ai_assessment table.
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

# --- !Downs
UPDATE user_stat SET high_quality_manual = NULL WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

DROP TABLE IF EXISTS label_ai_info;
