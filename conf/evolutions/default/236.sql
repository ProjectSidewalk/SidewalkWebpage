# --- !Ups
UPDATE validation_options SET text = 'unsure' WHERE text = 'notsure';
ALTER TABLE label RENAME COLUMN notsure_count TO unsure_count;

TRUNCATE TABLE label_history;
ALTER TABLE label_history
    ADD COLUMN source TEXT NOT NULL,
    ADD COLUMN label_validation_id INT,
    ADD CONSTRAINT label_history_label_validation_id_fkey FOREIGN KEY (label_validation_id) REFERENCES label_validation (label_validation_id);

-- Fill in label_history table with an initial entry for every label.
INSERT INTO label_history (label_id, severity, tags, edited_by, edit_time, source, label_validation_id)
SELECT label_id, severity, tags, user_id, time_created, 'Explore', NULL
FROM label;

# --- !Downs
ALTER TABLE label_history
    DROP COLUMN label_validation_id,
    DROP COLUMN source;

ALTER TABLE label RENAME COLUMN unsure_count TO notsure_count;
UPDATE validation_options SET text = 'notsure' WHERE text = 'unsure';
