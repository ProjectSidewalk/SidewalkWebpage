# --- !Ups
UPDATE validation_options
SET text = 'notsure'
WHERE text = 'unclear';

-- For users who validated the same label multiple times, remove all but the newest validation.
DELETE
FROM label_validation val_a
    USING label_validation val_b
WHERE val_a.label_id = val_b.label_id
  AND val_a.user_id = val_b.user_id
  AND val_a.end_timestamp < val_b.end_timestamp;

-- Add validation count columns to the label table.
ALTER TABLE label
    ADD COLUMN agree_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN disagree_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN notsure_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN correct BOOLEAN;

-- Populate table with current validation info.
UPDATE label
SET (agree_count, disagree_count, notsure_count, correct) = (n_agree, n_disagree, n_notsure, is_correct)
FROM (
     SELECT label.label_id,
            COUNT(CASE WHEN validation_result = 1 THEN 1 END) AS n_agree,
            COUNT(CASE WHEN validation_result = 2 THEN 1 END) AS n_disagree,
            COUNT(CASE WHEN validation_result = 3 THEN 1 END) AS n_notsure,
            CASE
                WHEN COUNT(CASE WHEN validation_result = 1 THEN 1 END) > COUNT(CASE WHEN validation_result = 2 THEN 1 END) THEN TRUE
                WHEN COUNT(CASE WHEN validation_result = 2 THEN 1 END) > COUNT(CASE WHEN validation_result = 1 THEN 1 END) THEN FALSE
                ELSE NULL
            END AS is_correct
     FROM mission
     INNER JOIN label ON mission.mission_id = label.mission_id
     INNER JOIN label_validation
        ON label.label_id = label_validation.label_id AND mission.user_id <> label_validation.user_id
     GROUP BY label.label_id
 ) AS validation_count
WHERE label.label_id = validation_count.label_id;

TRUNCATE TABLE global_clustering_session CASCADE;
TRUNCATE TABLE user_clustering_session CASCADE;

ALTER TABLE global_attribute
    ADD COLUMN street_edge_id INTEGER NOT NULL DEFAULT -1;

# --- !Downs
ALTER TABLE global_attribute DROP COLUMN street_edge_id;

ALTER TABLE label
    DROP COLUMN correct,
    DROP COLUMN notsure_count,
    DROP COLUMN disagree_count,
    DROP COLUMN agree_count;

UPDATE validation_options
SET text = 'unclear'
WHERE text = 'notsure';
