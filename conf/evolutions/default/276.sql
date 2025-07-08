# --- !Ups
BEGIN;

-- Remove any tags that shouldn't be there anymore.
UPDATE config
SET excluded_tags = REPLACE(excluded_tags, ' "has button"', '');
UPDATE config
SET excluded_tags = REPLACE(excluded_tags, ' "painted sidewalk"', '');

-- Step 1: Add a temporary column to store the new JSONB data.
ALTER TABLE config
    ADD COLUMN excluded_tags_new JSONB;

-- Step 2: Create a function to convert the old format to new format.
-- NOTE evolutions don't deal well with dollar quoting, so we use double semicolons to avoid issues.
CREATE OR REPLACE FUNCTION convert_excluded_tags(old_tags TEXT)
    RETURNS JSONB AS
$BODY$
DECLARE
    tag_array    TEXT[];;
    tag_name     TEXT;;
    result       JSONB := '[]'::jsonb;;
    tag_record   RECORD;;
    cleaned_tags TEXT;;
    i            INTEGER;;
BEGIN
    -- Parse the old format: ["tag1" "tag2" "tag3"]. Remove the outer brackets and trim.
    cleaned_tags := trim(old_tags, '[]');;

    -- Split by '" "' pattern (the space between quoted tags).
    tag_array := string_to_array(cleaned_tags, '" "');;

    -- Clean up each tag (remove any remaining quotes).
    FOR i IN 1..array_length(tag_array, 1)
        LOOP
            tag_array[i] := trim(tag_array[i], '"');;
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
                    result := result || jsonb_build_object(
                            'label_type', tag_record.label_type,
                            'tag', tag_record.tag
                                        );;
                END LOOP;;
        END LOOP;;

    RETURN result;;
END;;
$BODY$ LANGUAGE plpgsql;

-- Step 3: Convert all existing data.
UPDATE config
SET excluded_tags_new = convert_excluded_tags(excluded_tags);

-- Step 4: Drop the old column and rename the new one.
ALTER TABLE config
    DROP COLUMN excluded_tags;
ALTER TABLE config
    RENAME COLUMN excluded_tags_new TO excluded_tags;

-- Step 5: Add a check constraint to ensure valid JSON structure.
ALTER TABLE config
    ADD CONSTRAINT excluded_tags_valid_json
        CHECK (
            excluded_tags IS NOT NULL
                AND jsonb_typeof(excluded_tags) = 'array'
            );

-- Step 6: Create an index for better query performance.
CREATE INDEX idx_config_excluded_tags_gin ON config USING gin (excluded_tags);

-- Step 7: Clean up the temporary function.
DROP FUNCTION convert_excluded_tags(TEXT);

-- Step 8: Add helpful comments.
COMMENT ON COLUMN config.excluded_tags IS 'Array of excluded tags in JSON format: [{"label_type": "LabelType", "tag": "tag_name"}]';

COMMIT;

# --- !Downs
-- Rollback migration: Convert excluded_tags from JSONB back to TEXT format.
BEGIN;

-- Step 1: Add a temporary column to store the old TEXT format.
ALTER TABLE config
    ADD COLUMN excluded_tags_old_format TEXT;

-- Step 2: Create a function to convert JSONB back to the old TEXT format.
-- NOTE evolutions don't deal well with dollar quoting, so we use double semicolons to avoid issues.
CREATE OR REPLACE FUNCTION convert_excluded_tags_to_text(new_tags JSONB)
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
        SELECT DISTINCT elem ->> 'tag' as tag_name
        FROM jsonb_array_elements(new_tags) as elem
        ORDER BY elem ->> 'tag' -- Sort for consistent output
        LOOP
            -- Add each tag to the array (with quotes).
            result_array := result_array || ('"' || tag_record.tag_name || '"');;
        END LOOP;;

    -- Build the final string in the old format.
    IF array_length(result_array, 1) > 0 THEN
        result_text := '[' || array_to_string(result_array, ' ') || ']';;
    ELSE
        result_text := '[]';;
    END IF;;

    RETURN result_text;;
END;;
$BODY$ LANGUAGE plpgsql;

-- Step 3: Convert all existing JSONB data back to TEXT format.
UPDATE config
SET excluded_tags_old_format = convert_excluded_tags_to_text(excluded_tags);

-- Step 4: Drop constraints and indexes related to JSONB.
DROP INDEX IF EXISTS idx_config_excluded_tags_gin;
ALTER TABLE config
    DROP CONSTRAINT IF EXISTS excluded_tags_valid_json;

-- Step 5: Drop the JSONB column and rename the TEXT column.
ALTER TABLE config
    DROP COLUMN excluded_tags;
ALTER TABLE config
    RENAME COLUMN excluded_tags_old_format TO excluded_tags;

-- Step 6: Clean up the temporary function.
DROP FUNCTION convert_excluded_tags_to_text(JSONB);

-- Step 7: Update column comment.
COMMENT ON COLUMN config.excluded_tags IS 'Array of excluded tags in TEXT format: ["tag1" "tag2" "tag3"]';

COMMIT;
