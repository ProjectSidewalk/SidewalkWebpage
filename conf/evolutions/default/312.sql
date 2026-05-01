# --- !Ups
ALTER TABLE label_ai_assessment ADD COLUMN tags_not_present TEXT[] DEFAULT '{}';

-- Backfill `tags` and `tags_not_present` for existing rows using the new per-tag thresholds. The AI models haven't
-- changed, so the stored `tags_confidence` scores are still valid -- only the rules for promoting a score to a
-- "present" or "not present" suggestion have changed. Thresholds are defined here:
-- https://github.com/ProjectSidewalk/sidewalk-ai-api/commit/fe0652dc5fc0d01f565a5800fc0f12732f74dfc4#diff-b6c2623e405dd5ad8df81926b45fa6598fe31018a5f8d291267039ea44ab3467
WITH
add_thresholds(label_type_id, tag, threshold) AS (VALUES
    -- CurbRamp.
    (1, 'missing tactile warning', 0.999032616615295::DOUBLE PRECISION),
    -- Obstacle.
    (3, 'parked car',              0.99954742193222::DOUBLE PRECISION),
    (3, 'trash/recycling can',     0.996601343154907::DOUBLE PRECISION),
    -- SurfaceProblem.
    (4, 'brick/cobblestone',       0.460518807172775::DOUBLE PRECISION),
    (4, 'grass',                   0.878179550170898::DOUBLE PRECISION),
    (4, 'height difference',       0.990894317626953::DOUBLE PRECISION)
    -- Crosswalk: none.
),
remove_thresholds(label_type_id, tag, threshold) AS (VALUES
    -- CurbRamp.
    (1, 'missing tactile warning', 0.137371987104416::DOUBLE PRECISION),
    (1, 'points into traffic',     0.0000236960186157376::DOUBLE PRECISION),
    (1, 'surface problem',         0.0124074257910252::DOUBLE PRECISION),
    -- Obstacle.
    (3, 'construction',            0.00129300216212869::DOUBLE PRECISION),
    (3, 'parked car',              0.415593057870865::DOUBLE PRECISION),
    (3, 'pole',                    0.538854777812958::DOUBLE PRECISION),
    (3, 'trash/recycling can',     0.99326080083847::DOUBLE PRECISION),
    (3, 'vegetation',              0.999191462993622::DOUBLE PRECISION),
    -- SurfaceProblem.
    (4, 'brick/cobblestone',       0.000102744284959044::DOUBLE PRECISION),
    (4, 'grass',                   0.512212753295898::DOUBLE PRECISION),
    (4, 'height difference',       0.0114266304299235::DOUBLE PRECISION),
    -- Crosswalk.
    (9, 'broken surface',          0.997941434383392::DOUBLE PRECISION),
    (9, 'bumpy',                   0.000261053384747356::DOUBLE PRECISION),
    (9, 'paint fading',            0.000167091304319911::DOUBLE PRECISION)
),
-- Flatten tags_confidence (a JSONB array of {tag, confidence}) into one row per (assessment, tag).
expanded AS (
    SELECT label_ai_assessment.label_ai_assessment_id,
           label.label_type_id,
           tc.tag,
           tc.confidence
    FROM label_ai_assessment
    JOIN label ON label.label_id = label_ai_assessment.label_id
    CROSS JOIN LATERAL jsonb_to_recordset(label_ai_assessment.tags_confidence)
        AS tc(tag TEXT, confidence DOUBLE PRECISION)
    WHERE label_ai_assessment.tags_confidence IS NOT NULL
),
new_tags AS (
    SELECT expanded.label_ai_assessment_id,
           ARRAY_AGG(expanded.tag ORDER BY expanded.tag) AS tags
    FROM expanded
    JOIN add_thresholds
        ON add_thresholds.label_type_id = expanded.label_type_id
        AND add_thresholds.tag = expanded.tag
    WHERE expanded.confidence > add_thresholds.threshold
    GROUP BY expanded.label_ai_assessment_id
),
new_tags_not_present AS (
    SELECT expanded.label_ai_assessment_id,
           ARRAY_AGG(expanded.tag ORDER BY expanded.tag) AS tags_not_present
    FROM expanded
    JOIN remove_thresholds
        ON remove_thresholds.label_type_id = expanded.label_type_id
        AND remove_thresholds.tag = expanded.tag
    WHERE expanded.confidence < remove_thresholds.threshold
    GROUP BY expanded.label_ai_assessment_id
)
UPDATE label_ai_assessment
SET tags = COALESCE(new_tags.tags, '{}'),
    tags_not_present = COALESCE(new_tags_not_present.tags_not_present, '{}')
FROM label_ai_assessment AS laa_self
LEFT JOIN new_tags ON new_tags.label_ai_assessment_id = laa_self.label_ai_assessment_id
LEFT JOIN new_tags_not_present ON new_tags_not_present.label_ai_assessment_id = laa_self.label_ai_assessment_id
WHERE label_ai_assessment.label_ai_assessment_id = laa_self.label_ai_assessment_id;

# --- !Downs
ALTER TABLE label_ai_assessment DROP COLUMN tags_not_present;
