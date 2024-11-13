# --- !Ups
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 72, label_type_id, 'not aligned with crosswalk', NULL FROM label_type WHERE label_type.label_type = 'CurbRamp';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 73, label_type_id, 'utility cabinet', NULL FROM label_type WHERE label_type.label_type = 'Obstacle';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 74, label_type_id, 'cycle lane: protection from traffic', NULL FROM label_type WHERE label_type.label_type = 'Other';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 75, label_type_id, 'cycle lane: no protection from traffic', NULL FROM label_type WHERE label_type.label_type = 'Other';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 76, label_type_id, 'cycle lane: surface problem', NULL FROM label_type WHERE label_type.label_type = 'Other';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 77, label_type_id, 'cycle lane: faded paint', NULL FROM label_type WHERE label_type.label_type = 'Other';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 78, label_type_id, 'cycle lane: debris / pooled water', NULL FROM label_type WHERE label_type.label_type = 'Other';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 79, label_type_id, 'cycle lane: parked car', NULL FROM label_type WHERE label_type.label_type = 'Other';
INSERT INTO tag (tag_id, label_type_id, tag, mutually_exclusive_with) SELECT 80, label_type_id, 'cycle box', NULL FROM label_type WHERE label_type.label_type = 'Other';

-- Hide 'not aligned with crosswalk' and 'utility cabinet' tags in non-Taiwanese cities.
UPDATE config
SET excluded_tags = REPLACE(excluded_tags, '"]', '" "not aligned with crosswalk" "utility cabinet"]')
WHERE current_schema() NOT IN ('sidewalk_taipei', 'sidewalk_new_taipei', 'sidewalk_keelung', 'sidewalk_taichung', 'sidewalk_kaohsiung');

-- Only show cycle lane tags in Chicago.
UPDATE config
SET excluded_tags = REPLACE(excluded_tags, '"]', '" "cycle lane: protection from traffic" "cycle lane: no protection from traffic" "cycle lane: surface problem" "cycle lane: faded paint" "cycle lane: debris / pooled water" "cycle lane: parked car" "cycle box"]')
WHERE current_schema() = 'sidewalk_chicago';

# --- !Downs
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "cycle box"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "cycle lane: parked car"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "cycle lane: debris / pooled water"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "cycle lane: faded paint"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "cycle lane: surface problem"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "cycle lane: no protection from traffic"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "cycle lane: protection from traffic"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "utility cabinet"', '');
UPDATE config SET excluded_tags = REPLACE(excluded_tags, ' "not aligned with crosswalk"', '');

UPDATE label_history SET tags = array_remove(tags, 'cycle box');
UPDATE label_history SET tags = array_remove(tags, 'cycle lane: parked car');
UPDATE label_history SET tags = array_remove(tags, 'cycle lane: debris / pooled water');
UPDATE label_history SET tags = array_remove(tags, 'cycle lane: faded paint');
UPDATE label_history SET tags = array_remove(tags, 'cycle lane: surface problem');
UPDATE label_history SET tags = array_remove(tags, 'cycle lane: no protection from traffic');
UPDATE label_history SET tags = array_remove(tags, 'cycle lane: protection from traffic');
UPDATE label_history SET tags = array_remove(tags, 'utility cabinet');
UPDATE label_history SET tags = array_remove(tags, 'not aligned with crosswalk');

-- Delete entries in the label_history table that no longer represent a change in history after removing the tag.
DELETE FROM label_history
WHERE label_history_id IN (
    SELECT label_history_id
    FROM (
        SELECT label_history_id, label_id, severity, tags,
               LAG(severity) OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_severity,
               LAG(tags) OVER (PARTITION BY label_id ORDER BY edit_time) AS prev_tags
        FROM label_history
    ) subquery
    WHERE severity = prev_severity
        AND tags = prev_tags
);

DELETE FROM tag
USING label_type
WHERE tag.label_type_id = label_type.label_type_id
    AND (
        label_type.label_type = 'CurbRamp' AND tag.tag = 'not aligned with crosswalk'
        OR label_type.label_type = 'Obstacle' AND tag.tag = 'utility cabinet'
        OR label_type.label_type = 'Other' AND tag.tag = 'cycle lane: protection from traffic'
        OR label_type.label_type = 'Other' AND tag.tag = 'cycle lane: no protection from traffic'
        OR label_type.label_type = 'Other' AND tag.tag = 'cycle lane: surface problem'
        OR label_type.label_type = 'Other' AND tag.tag = 'cycle lane: faded paint'
        OR label_type.label_type = 'Other' AND tag.tag = 'cycle lane: debris / pooled water'
        OR label_type.label_type = 'Other' AND tag.tag = 'cycle lane: parked car'
        OR label_type.label_type = 'Other' AND tag.tag = 'cycle box'
    );
