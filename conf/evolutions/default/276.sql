# --- !Ups
-- Clean up any old tags that shouldn't be there anymore, since it will break the migration script.
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "has button"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "painted sidewalk"', '');

-- Rollout migration: Convert excluded_tags from TEXT format to JSONB format.
-- Step 1: Add a temporary column to store the new JSONB data.
ALTER TABLE config ADD COLUMN excluded_tags_new jsonb;

-- Step 2: Create a function to convert the old format to new format.
-- NOTE evolutions don't deal well with dollar quoting, so we use double semicolons to avoid issues.
CREATE OR REPLACE FUNCTION convert_excluded_tags(
    old_tags TEXT
) RETURNS jsonb AS
$BODY$
DECLARE
    tag_array    TEXT[];;
    tag_name     TEXT;;
    result       jsonb := '[]'::jsonb;;
    tag_record   RECORD;;
    cleaned_tags TEXT;;
    i            INTEGER;;
BEGIN
    -- Parse the old format: ["tag1" "tag2" "tag3"]. Remove the outer brackets and trim.
    cleaned_tags := TRIM(old_tags, '[]');;

    -- Split by '" "' pattern (the space between quoted tags).
    tag_array := STRING_TO_ARRAY(cleaned_tags, '" "');;

    -- Clean up each tag (remove any remaining quotes).
    FOR i IN 1..ARRAY_LENGTH(tag_array, 1)
        LOOP
            tag_array[i] := TRIM(tag_array[i], '"');;
        END LOOP;;

    -- For each tag, find its label_type and create JSON object.
    FOREACH tag_name IN ARRAY tag_array
        LOOP
            -- Find all matching tags with their label types.
            FOR tag_record IN
                SELECT lt.label_type, t.tag
                FROM tag t
                JOIN label_type lt ON t.label_type_id = lt.label_type_id
                WHERE t.tag = tag_name
                LOOP
                    -- Add each matching tag with its label type.
                    result := result || JSONB_BUILD_OBJECT(
                            'label_type', tag_record.label_type,
                            'tag', tag_record.tag
                                        );;
                END LOOP;;
        END LOOP;;

    RETURN result;;
END;;
$BODY$ LANGUAGE plpgsql;

-- Step 3: Convert all existing data.
UPDATE config SET excluded_tags_new = convert_excluded_tags(excluded_tags);

-- Step 4: Drop the old column and rename the new one.
ALTER TABLE config DROP COLUMN excluded_tags;
ALTER TABLE config RENAME COLUMN excluded_tags_new TO excluded_tags;

-- Step 5: Add a check constraint to ensure valid JSON structure.
ALTER TABLE config
    ADD CONSTRAINT excluded_tags_valid_json
        CHECK (excluded_tags IS NOT NULL AND JSONB_TYPEOF(excluded_tags) = 'array');

-- Step 6: Create an index for better query performance.
CREATE INDEX idx_config_excluded_tags_gin ON config USING gin (excluded_tags);

-- Step 7: Clean up the temporary function.
DROP FUNCTION convert_excluded_tags(
    TEXT
);

-- Step 8: Add helpful comments.
COMMENT ON COLUMN config.excluded_tags IS 'Array of excluded tags in JSON format: [{"label_type": "LabelType", "tag": "tag_name"}]';

-- Exclude tags on Chandigarh server that we don't use there.
UPDATE config
SET excluded_tags = excluded_tags || '[
  {
    "label_type": "CurbRamp",
    "tag": "points into traffic"
  },
  {
    "label_type": "CurbRamp",
    "tag": "steep"
  },
  {
    "label_type": "CurbRamp",
    "tag": "not enough landing space"
  },
  {
    "label_type": "CurbRamp",
    "tag": "missing tactile warning"
  },
  {
    "label_type": "CurbRamp",
    "tag": "surface problem"
  },
  {
    "label_type": "Obstacle",
    "tag": "fire hydrant"
  },
  {
    "label_type": "Obstacle",
    "tag": "trash/recycling can"
  },
  {
    "label_type": "Obstacle",
    "tag": "height difference"
  },
  {
    "label_type": "Obstacle",
    "tag": "narrow"
  },
  {
    "label_type": "Obstacle",
    "tag": "parked scooter/motorcycle"
  },
  {
    "label_type": "Obstacle",
    "tag": "mailbox"
  },
  {
    "label_type": "SurfaceProblem",
    "tag": "construction"
  },
  {
    "label_type": "SurfaceProblem",
    "tag": "rail/tram track"
  },
  {
    "label_type": "SurfaceProblem",
    "tag": "utility panel"
  },
  {
    "label_type": "SurfaceProblem",
    "tag": "debris"
  },
  {
    "label_type": "NoSidewalk",
    "tag": "shared pedestrian/car space"
  },
  {
    "label_type": "NoSidewalk",
    "tag": "street has a sidewalk"
  },
  {
    "label_type": "NoSidewalk",
    "tag": "street has no sidewalks"
  },
  {
    "label_type": "Crosswalk",
    "tag": "rail/tram track"
  },
  {
    "label_type": "Signal",
    "tag": "APS"
  },
  {
    "label_type": "CurbRamp",
    "tag": "hard to reach buttons"
  },
  {
    "label_type": "CurbRamp",
    "tag": "one button"
  },
  {
    "label_type": "CurbRamp",
    "tag": "two buttons"
  }
]'::jsonb
WHERE '$evolutions{{{city-id}}}' = 'chandigarh-india';

-- Add the street vendor tag back into Chandigarh.
UPDATE config
SET excluded_tags = (
    SELECT JSONB_AGG(elem)
    FROM JSONB_ARRAY_ELEMENTS(excluded_tags) elem
    WHERE elem NOT IN (
        '{
          "label_type": "Obstacle",
          "tag": "street vendor"
        }'::jsonb
        )
)
WHERE '$evolutions{{{city-id}}}' = 'chandigarh-india';

-- Add new Chandigarh-specific tags.
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with)
SELECT 81, label_type_id, 'not visible', NULL
FROM label_type
WHERE label_type.label_type = 'CurbRamp';

INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with)
SELECT 82, label_type_id, 'cart', NULL
FROM label_type
WHERE label_type.label_type = 'Obstacle';

INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with)
SELECT 83, label_type_id, 'drainage', NULL
FROM label_type
WHERE label_type.label_type = 'Obstacle';

INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with)
SELECT 84, label_type_id, 'electrical box', NULL
FROM label_type
WHERE label_type.label_type = 'Obstacle';

INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with)
SELECT 85, label_type_id, 'too dirty/cluttered', NULL
FROM label_type
WHERE label_type.label_type = 'NoSidewalk';

-- Hide these new tags in all cities except Chandigarh.
UPDATE config
SET excluded_tags = excluded_tags || '[
  {
    "label_type": "CurbRamp",
    "tag": "not visible"
  },
  {
    "label_type": "Obstacle",
    "tag": "cart"
  },
  {
    "label_type": "Obstacle",
    "tag": "drainage"
  },
  {
    "label_type": "Obstacle",
    "tag": "electrical box"
  },
  {
    "label_type": "NoSidewalk",
    "tag": "too dirty/cluttered"
  }
]'::jsonb
WHERE '$evolutions{{{city-id}}}' <> 'chandigarh-india';

# --- !Downs
-- Remove the newly added tags. First from the config table.
UPDATE config
SET excluded_tags = (
    SELECT JSONB_AGG(elem)
    FROM JSONB_ARRAY_ELEMENTS(excluded_tags) elem
    WHERE elem NOT IN ('{
      "label_type": "CurbRamp",
      "tag": "not visible"
    }'::jsonb, '{
      "label_type": "Obstacle",
      "tag": "cart"
    }'::jsonb, '{
      "label_type": "Obstacle",
      "tag": "drainage"
    }'::jsonb, '{
      "label_type": "Obstacle",
      "tag": "electrical box"
    }'::jsonb, '{
      "label_type": "NoSidewalk",
      "tag": "too dirty/cluttered"
    }'::jsonb)
);

-- Remove the newly added tags from the label table.
UPDATE label
SET tags = ARRAY(SELECT elem FROM UNNEST(tags) AS elem WHERE elem NOT IN ('not visible'))
FROM label_type
WHERE label.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'CurbRamp';

UPDATE label
SET tags = ARRAY(SELECT elem FROM UNNEST(tags) AS elem WHERE elem NOT IN ('cart', 'drainage', 'electrical box'))
FROM label_type
WHERE label.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'Obstacle';

UPDATE label
SET tags = ARRAY(SELECT elem FROM UNNEST(tags) AS elem WHERE elem NOT IN ('too dirty/cluttered'))
FROM label_type
WHERE label.label_type_id = label_type.label_type_id
  AND label_type.label_type = 'NoSidewalk';

-- Remove the newly added tags from label_history.
UPDATE label_history
SET tags = ARRAY(SELECT elem FROM UNNEST(label_history.tags) AS elem WHERE elem NOT IN ('not visible'))
FROM label
JOIN label_type ON label.label_type_id = label_type.label_type_id
WHERE label_history.label_id = label.label_id
  AND label_type.label_type = 'CurbRamp';

UPDATE label_history
SET tags = ARRAY(SELECT elem
                 FROM UNNEST(label_history.tags) AS elem
                 WHERE elem NOT IN ('cart', 'drainage', 'electrical box'))
FROM label
JOIN label_type ON label.label_type_id = label_type.label_type_id
WHERE label_history.label_id = label.label_id
  AND label_type.label_type = 'Obstacle';

UPDATE label_history
SET tags = ARRAY(SELECT elem FROM UNNEST(label_history.tags) AS elem WHERE elem NOT IN ('too dirty/cluttered'))
FROM label
JOIN label_type ON label.label_type_id = label_type.label_type_id
WHERE label_history.label_id = label.label_id
  AND label_type.label_type = 'NoSidewalk';

-- Delete entries in the label_history table that no longer represent a change in history after removing the tags.
DELETE
FROM label_history
WHERE label_history_id IN (
    SELECT label_history_id
    FROM (
        SELECT label_history_id,
               label_id,
               severity,
               tags,
               LAG(severity) OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_severity,
               LAG(tags) OVER (PARTITION BY label_id ORDER BY edit_time)     AS prev_tags
        FROM label_history
    ) subquery
    WHERE severity = prev_severity
      AND tags = prev_tags
);

-- And finally remove the tags from the tag table.
DELETE
FROM tag
    USING label_type
WHERE tag.label_type_id = label_type.label_type_id
  AND (
    label_type.label_type = 'CurbRamp' AND tag.tag = 'not visible'
        OR label_type.label_type = 'Obstacle' AND tag.tag = 'cart'
        OR label_type.label_type = 'Obstacle' AND tag.tag = 'drainage'
        OR label_type.label_type = 'Obstacle' AND tag.tag = 'electrical box'
        OR label_type.label_type = 'NoSidewalk' AND tag.tag = 'too dirty/cluttered'
    );

-- Rollback migration: Convert excluded_tags from JSONB back to TEXT format.
-- Step 1: Add a temporary column to store the old TEXT format.
ALTER TABLE config ADD COLUMN excluded_tags_old_format TEXT;

-- Step 2: Create a function to convert JSONB back to the old TEXT format.
-- NOTE evolutions don't deal well with dollar quoting, so we use double semicolons to avoid issues.
CREATE OR REPLACE FUNCTION convert_excluded_tags_to_text(
    new_tags jsonb
)
    RETURNS TEXT AS
$BODY$
DECLARE
    tag_record   RECORD;;
    result_array TEXT[] := ARRAY []::TEXT[];;
    result_text  TEXT;;
BEGIN
    -- Handle NULL or empty arrays.
    IF new_tags IS NULL OR new_tags = '[]'::jsonb THEN
        RETURN '[]';;
    END IF;;

    -- Extract each tag from the JSONB array.
    FOR tag_record IN
        SELECT DISTINCT elem ->> 'tag' AS tag_name
        FROM JSONB_ARRAY_ELEMENTS(new_tags) AS elem
        ORDER BY elem ->> 'tag' -- Sort for consistent output
        LOOP
            -- Add each tag to the array (with quotes).
            result_array := result_array || ('"' || tag_record.tag_name || '"');;
        END LOOP;;

    -- Build the final string in the old format.
    IF ARRAY_LENGTH(result_array, 1) > 0
    THEN
        result_text := '[' || ARRAY_TO_STRING(result_array, ' ') || ']';;
    ELSE
        result_text := '[]';;
    END IF;;

    RETURN result_text;;
END;;
$BODY$ LANGUAGE plpgsql;

-- Step 3: Convert all existing JSONB data back to TEXT format.
UPDATE config SET excluded_tags_old_format = convert_excluded_tags_to_text(excluded_tags);

-- Step 4: Drop constraints and indexes related to JSONB.
DROP INDEX IF EXISTS idx_config_excluded_tags_gin;
ALTER TABLE config DROP CONSTRAINT IF EXISTS excluded_tags_valid_json;

-- Step 5: Drop the JSONB column and rename the TEXT column.
ALTER TABLE config DROP COLUMN excluded_tags;
ALTER TABLE config RENAME COLUMN excluded_tags_old_format TO excluded_tags;

-- Step 6: Clean up the temporary function.
DROP FUNCTION convert_excluded_tags_to_text(
    jsonb
);

-- Step 7: Update column comment.
COMMENT ON COLUMN config.excluded_tags IS 'Array of excluded tags in TEXT format: ["tag1" "tag2" "tag3"]';
