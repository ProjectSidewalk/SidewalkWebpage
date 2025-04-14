# --- !Ups

-- Create a new global_user_stats table if it doesn't exist
CREATE TABLE IF NOT EXISTS global_user_stats (
  user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES sidewalk_user(user_id),
  tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE,
  first_login_date TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Populate the table with existing users who have completed the tutorial
INSERT INTO global_user_stats (user_id, tutorial_completed)
SELECT su.user_id, 
       CASE WHEN EXISTS (
         SELECT 1
         FROM mission AS m
         JOIN mission_type AS mt ON m.mission_type_id = mt.mission_type_id
         WHERE m.user_id = su.user_id
         AND mt.mission_type = 'auditOnboarding'
         AND m.completed = TRUE
       ) THEN TRUE ELSE FALSE END
FROM sidewalk_user AS su
ON CONFLICT (user_id) DO NOTHING;

# --- !Downs

DROP TABLE IF EXISTS global_user_stats;