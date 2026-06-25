# --- !Ups
-- Replace the integer-keyed validation_options lookup table with a proper Postgres enum type.
CREATE TYPE validation_option AS ENUM ('Agree', 'Disagree', 'Unsure');

-- Convert label_validation.validation_result from an integer FK into the enum.
ALTER TABLE label_validation DROP CONSTRAINT label_validation_validation_result_fkey;
ALTER TABLE label_validation
    ALTER COLUMN validation_result TYPE validation_option
    USING (CASE validation_result
               WHEN 1 THEN 'Agree'
               WHEN 2 THEN 'Disagree'
               WHEN 3 THEN 'Unsure'
           END)::validation_option;

-- Convert label_ai_assessment.validation_result (same 1/2/3 semantics, but never had an FK) into the enum.
ALTER TABLE label_ai_assessment
    ALTER COLUMN validation_result TYPE validation_option
    USING (CASE validation_result
               WHEN 1 THEN 'Agree'
               WHEN 2 THEN 'Disagree'
               WHEN 3 THEN 'Unsure'
           END)::validation_option;

DROP TABLE validation_options;

# --- !Downs
CREATE TABLE validation_options (
    validation_option_id INTEGER PRIMARY KEY,
    text TEXT NOT NULL
);
INSERT INTO validation_options (validation_option_id, text)
VALUES (1, 'agree'), (2, 'disagree'), (3, 'unsure');

ALTER TABLE label_ai_assessment
    ALTER COLUMN validation_result TYPE INTEGER
    USING (CASE validation_result
               WHEN 'Agree' THEN 1
               WHEN 'Disagree' THEN 2
               WHEN 'Unsure' THEN 3
           END);

ALTER TABLE label_validation
    ALTER COLUMN validation_result TYPE INTEGER
    USING (CASE validation_result
               WHEN 'Agree' THEN 1
               WHEN 'Disagree' THEN 2
               WHEN 'Unsure' THEN 3
           END);
ALTER TABLE label_validation
    ADD CONSTRAINT label_validation_validation_result_fkey
    FOREIGN KEY (validation_result) REFERENCES validation_options(validation_option_id);

DROP TYPE validation_option;
