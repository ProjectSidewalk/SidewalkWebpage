# --- !Ups
ALTER TABLE label
    ALTER COLUMN time_created TYPE TIMESTAMPTZ USING time_created AT TIME ZONE 'PST',
    ALTER COLUMN time_created SET DEFAULT now();

ALTER TABLE user_survey_text_submission
    ALTER COLUMN time_submitted TYPE TIMESTAMPTZ USING time_submitted AT TIME ZONE 'PST',
    ALTER COLUMN time_submitted SET DEFAULT now();

ALTER TABLE user_survey_option_submission
    ALTER COLUMN time_submitted TYPE TIMESTAMPTZ USING time_submitted AT TIME ZONE 'PST',
    ALTER COLUMN time_submitted SET DEFAULT now();

ALTER TABLE version
    ALTER COLUMN version_start_time TYPE TIMESTAMPTZ USING version_start_time AT TIME ZONE 'PST',
    ALTER COLUMN version_start_time SET DEFAULT now();

ALTER TABLE user_clustering_session
    ALTER COLUMN time_created TYPE TIMESTAMPTZ USING time_created AT TIME ZONE 'PST',
    ALTER COLUMN time_created SET DEFAULT now();

ALTER TABLE global_clustering_session
    ALTER COLUMN time_created TYPE TIMESTAMPTZ USING time_created AT TIME ZONE 'PST',
    ALTER COLUMN time_created SET DEFAULT now();

ALTER TABLE mission
    ALTER COLUMN mission_start TYPE TIMESTAMPTZ USING mission_start AT TIME ZONE 'PST',
    ALTER COLUMN mission_start SET DEFAULT now(),
    ALTER COLUMN mission_end TYPE TIMESTAMPTZ USING mission_end AT TIME ZONE 'PST',
    ALTER COLUMN mission_end SET DEFAULT now();

# --- !Downs
ALTER TABLE mission
    ALTER COLUMN mission_start TYPE TIMESTAMP,
    ALTER COLUMN mission_start DROP DEFAULT,
    ALTER COLUMN mission_end TYPE TIMESTAMP,
    ALTER COLUMN mission_end DROP DEFAULT;

ALTER TABLE global_clustering_session
    ALTER COLUMN time_created TYPE TIMESTAMP,
    ALTER COLUMN time_created SET DEFAULT current_timestamp;

ALTER TABLE user_clustering_session
    ALTER COLUMN time_created TYPE TIMESTAMP,
    ALTER COLUMN time_created SET DEFAULT current_timestamp;

ALTER TABLE version
    ALTER COLUMN version_start_time TYPE TIMESTAMP,
    ALTER COLUMN version_start_time DROP DEFAULT;

ALTER TABLE user_survey_option_submission
    ALTER COLUMN time_submitted TYPE TIMESTAMP,
    ALTER COLUMN time_submitted DROP DEFAULT;

ALTER TABLE user_survey_text_submission
    ALTER COLUMN time_submitted TYPE TIMESTAMP,
    ALTER COLUMN time_submitted DROP DEFAULT;

ALTER TABLE label
    ALTER COLUMN time_created TYPE TIMESTAMP,
    ALTER COLUMN time_created DROP DEFAULT;
