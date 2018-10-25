# --- !Ups
ALTER TABLE problem_description RENAME COLUMN problem_description_id TO label_description_id;
ALTER TABLE problem_description RENAME TO label_description;

ALTER TABLE problem_severity RENAME COLUMN problem_severity_id TO label_severity_id;
ALTER TABLE problem_severity RENAME TO label_severity;

ALTER TABLE problem_temporariness RENAME COLUMN problem_temporariness_id TO label_temporariness_id;
ALTER TABLE problem_temporariness RENAME COLUMN temporary_problem TO temporary;
ALTER TABLE problem_temporariness RENAME TO label_temporariness;

# --- !Downs
ALTER TABLE label_temporariness RENAME TO problem_temporariness;
ALTER TABLE problem_temporariness RENAME COLUMN label_temporariness_id TO problem_temporariness_id;
ALTER TABLE problem_temporariness RENAME COLUMN temporary TO temporary_problem;

ALTER TABLE label_severity RENAME TO problem_severity;
ALTER TABLE problem_severity RENAME COLUMN label_severity_id TO problem_severity_id;

ALTER TABLE label_description RENAME TO problem_description;
ALTER TABLE problem_description RENAME COLUMN label_description_id TO problem_description_id;
