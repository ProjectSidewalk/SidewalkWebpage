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

# --- !Downs
DROP TABLE IF EXISTS label_ai_info;
