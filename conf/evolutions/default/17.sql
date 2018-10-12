# --- !Ups
ALTER TABLE problem_description RENAME TO label_description;
ALTER TABLE problem_severity RENAME TO label_severity;
ALTER TABLE problem_temporariness RENAME TO label_temporariness;

# --- !Downs
ALTER TABLE label_description RENAME TO problem_description;
ALTER TABLE label_severity RENAME TO problem_severity;
ALTER TABLE label_temporariness RENAME TO problem_temporariness;
