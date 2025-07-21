# --- !Ups
CREATE TABLE IF NOT EXISTS label_ai (
    label_ai_id SERIAL PRIMARY KEY,
    label_id INT NOT NULL,
    ai_tags TEXT[] DEFAULT '{}',
    ai_validation_result INT,
    ai_validation_accuracy DOUBLE PRECISION,
    api_version TEXT,
    time_created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (label_id) REFERENCES label(label_id)
);

# --- !Downs
DROP TABLE IF EXISTS label_ai;
