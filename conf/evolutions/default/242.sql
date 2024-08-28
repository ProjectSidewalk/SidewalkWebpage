# --- !Ups
DELETE FROM label_validation
WHERE label_validation_id IN (
  SELECT label_validation_id
  FROM (
    SELECT 
      label_validation_id,
      ROW_NUMBER() OVER (
        PARTITION BY label_id, user_id 
        ORDER BY end_timestamp DESC
      ) AS validation_rank
    FROM label_validation
  )
  WHERE validation_rank > 1
);

/*
This evolution addresses an issue where multiple validations could be created per label-user pair.
See PR #3632 for more details.

We're going to manually run a query to update the agree/disagree/unsure_count and correct columns
in the label table, so we aren't including it in this evolution.

We found no instances on prod where a user validated through the New Validate Beta and then changed
their validation elsewhere, so we don't have to worry about the label_history or label table.
*/

-- Add a unique constraint to ensure user_id and label_id are unique together
ALTER TABLE label_validation
ADD CONSTRAINT unique_user_label_validation
UNIQUE (user_id, label_id);
