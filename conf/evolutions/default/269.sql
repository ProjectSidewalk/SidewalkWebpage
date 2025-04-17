# --- !Ups
ALTER TABLE sidewalk_user ADD COLUMN IF NOT EXISTS tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE sidewalk_user AS su
SET tutorial_completed = TRUE
WHERE EXISTS (
  SELECT 1
  FROM mission AS m
  JOIN mission_type AS mt ON m.mission_type_id = mt.mission_type_id
  WHERE m.user_id = su.user_id
  AND mt.mission_type = 'auditOnboarding'
  AND m.completed = TRUE
);

# --- !Downs
ALTER TABLE sidewalk_user DROP COLUMN IF EXISTS tutorial_completed;
