# --- !Ups
CREATE TABLE IF NOT EXISTS label_ai (
    label_ai_id SERIAL PRIMARY KEY,
    label_id INT NOT NULL,
    ai_tags TEXT,
    ai_validation_result TEXT,
    ai_validation_accuracy DOUBLE PRECISION,
    FOREIGN KEY (label_id) REFERENCES label(label_id)
);

# --- !Downs
DROP TABLE IF EXISTS label_ai;
