# --- !Ups

-- Repair the off-target-markers bug (#4842). Labels placed in the bug window (2023-03-29 -> 2024-09-25) could be
-- submitted with a point-of-view record (heading/pitch) that went stale between the click and the staged batch
-- submission, while pano_x/pano_y -- computed and frozen at click time -- stayed true. Validate, Gallery, and
-- label-detail render the record side, so every stale record is a marker drawn off target.
--
-- The window bounds are release deploys, rounded outward. Start: the v7.12.2 deploy (2023-03-29 21:42 UTC), when the
-- client began writing pano_x/pano_y live with the exact projection -- the identifiability horizon. End: the v7.20.7
-- deploy (2024-09-25), the client fix. The last stale submission in every deployment lands that day (19:54-20:50
-- UTC), rounded up to midnight because the fix ships in client JS and an open tab can submit stale records after the
-- deploy. The bounds are literals rather than version-table lookups because version_start_time is stamped now() at
-- evolution-apply time per schema -- late-bootstrapped schemas collapse their whole release history to the creation
-- moment, and a missing row would make the bound NULL and turn the repair into a silent no-op.
--
-- Detection: forward-replay each in-window record through the production projection (the same math as evolution 179)
-- and compare where it renders against the label's own stored pano_x/pano_y, flagging misses beyond rounding noise
-- (> 2 px on either axis). Repair: re-solve heading and pitch in closed form so the record reproduces pano_x/pano_y
-- exactly. Only those two columns change -- canvas_x/y, zoom, pano_x/y, and lat/lng are untouched.
--
-- Excluded, and why: labels whose coordinate replays in a previous pano generation (heights 1664/3328/6656/8192) are
-- frame changes, not record errors -- the pano moved, the record is click-consistent, and "repairing" them would
-- corrupt truth. Records lacking pano metadata (width/height/camera_heading) cannot be replayed or repaired.
-- Tutorial labels use synthetic records on static panos. Pre-window labels are not identifiable (evolution 179
-- rewrote pano_x/pano_y FROM the records, so a stale record and its coordinate agree by construction). Deleted
-- labels ARE repaired -- they can be restored, and their data should be correct when they are.
--
-- Measurement and evidence: sidewalk-panorama-tools PR #80 (reports/2026-08-10-off-target-markers-validate.md).
-- Across all 54 measured deployments, 14.49% of in-window labels carry a stale record, and this closed-form re-solve
-- repairs 100.00% of them in every city (verified independently against the study corpus before this migration).

CREATE TABLE old_label_point_pov (
    label_id INTEGER NOT NULL,
    old_heading DOUBLE PRECISION NOT NULL,
    old_pitch DOUBLE PRECISION NOT NULL,
    new_heading DOUBLE PRECISION NOT NULL,
    new_pitch DOUBLE PRECISION NOT NULL,
    -- On-screen error of the OLD record in Validate-canvas px at the record's own zoom. Drives the >= 30 px
    -- validation voiding below and makes the repair auditable per label.
    old_render_error_px DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (label_id),
    FOREIGN KEY (label_id) REFERENCES label (label_id),
    CHECK (old_render_error_px >= 0)
);
ALTER TABLE old_label_point_pov OWNER TO sidewalk;

-- One pass computes everything: replay the stored record (pov_inputs -> ray -> replayed -> residuals), keep the
-- rows that miss their own coordinate by > 2 px and are not frame changes (mismatched), then re-solve the viewport
-- (solved -> repaired). The projection constants are the 720x480 Explore canvas (center 360, 240) and get3dFov's
-- zoom ladder, exactly as in evolution 179. ROUND on double precision is half-to-even, matching the client replay.
WITH pov_inputs AS (
    SELECT label.label_id,
           label_point.heading,
           label_point.pitch,
           label_point.pano_x,
           label_point.pano_y,
           pano_data.camera_heading,
           pano_data.width::DOUBLE PRECISION AS width,
           pano_data.height::DOUBLE PRECISION AS height,
           CASE WHEN label_point.zoom <= 2 THEN 126.5 - 36.75 * label_point.zoom
                ELSE 195.93 / POWER(1.92, label_point.zoom) END AS fov_deg,
           -- Focal length in canvas px: (canvas_width / 2) / tan(fov / 2).
           360.0 / TAN(0.5 * RADIANS(CASE WHEN label_point.zoom <= 2 THEN 126.5 - 36.75 * label_point.zoom
                                          ELSE 195.93 / POWER(1.92, label_point.zoom) END)) AS f,
           (label_point.canvas_x - 360)::DOUBLE PRECISION AS du,
           (240 - label_point.canvas_y)::DOUBLE PRECISION AS dv,
           RADIANS(label_point.heading) AS heading_rad,
           RADIANS(label_point.pitch) AS pitch_rad
    FROM label
    INNER JOIN label_point ON label.label_id = label_point.label_id
    INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
    WHERE label.time_created >= '2023-03-29 00:00:00+00'
        AND label.time_created < '2024-09-26 00:00:00+00'
        AND label.tutorial = FALSE
        AND pano_data.width IS NOT NULL
        AND pano_data.width > 0
        AND pano_data.height IS NOT NULL
        AND pano_data.camera_heading IS NOT NULL
        AND pano_data.camera_heading <> 'NaN'
), ray AS (
    -- The 3D ray through the record's canvas point: camera basis at (heading, pitch), focal f, offsets (du, dv).
    SELECT pov_inputs.*,
           f * COS(pitch_rad) * SIN(heading_rad)
               + du * (CASE WHEN COS(pitch_rad) >= 0 THEN 1.0 ELSE -1.0 END) * COS(heading_rad)
               - dv * SIN(pitch_rad) * SIN(heading_rad) AS ray_x,
           f * COS(pitch_rad) * COS(heading_rad)
               - du * (CASE WHEN COS(pitch_rad) >= 0 THEN 1.0 ELSE -1.0 END) * SIN(heading_rad)
               - dv * SIN(pitch_rad) * COS(heading_rad) AS ray_y,
           f * SIN(pitch_rad) + dv * COS(pitch_rad) AS ray_z
    FROM pov_inputs
), replayed AS (
    -- The direction that ray points, and the pano column of bearing zero (the raster is centred on camera_heading).
    SELECT ray.*,
           DEGREES(ATAN2(ray_x, ray_y)) + CASE WHEN ATAN2(ray_x, ray_y) < 0 THEN 360.0 ELSE 0.0 END AS pov_heading,
           DEGREES(ASIN(ray_z / SQRT(ray_x * ray_x + ray_y * ray_y + ray_z * ray_z))) AS pov_altitude,
           camera_heading + 180.0 - 360.0 * FLOOR((camera_heading + 180.0) / 360.0) AS heading_pixel_zero
    FROM ray
), residuals AS (
    -- Where the record renders in integer pano px, and the seam-aware miss against the stored coordinate.
    SELECT replayed.*,
           ABS((pano_x - ((width::INT + ROUND(width * (pov_heading - heading_pixel_zero) / 360.0)::INT) % width::INT))
               - width * ROUND((pano_x
                                - ((width::INT + ROUND(width * (pov_heading - heading_pixel_zero) / 360.0)::INT)
                                   % width::INT)) / width)) AS abs_dx,
           ABS(pano_y - (height / 2.0 - ROUND((height / 2.0) * pov_altitude / 90.0))::INT) AS abs_dy
    FROM replayed
), mismatched AS (
    -- Beyond rounding noise on either axis, and not explained by a previous pano generation (frame change).
    SELECT residuals.*
    FROM residuals
    WHERE (abs_dx > 2 OR abs_dy > 2)
        AND NOT EXISTS (
            SELECT 1
            FROM (VALUES (1664.0), (3328.0), (6656.0), (8192.0)) AS generation (gen_height)
            CROSS JOIN LATERAL (
                SELECT ((2 * generation.gen_height)::INT
                        + ROUND(2 * generation.gen_height * (residuals.pov_heading - residuals.heading_pixel_zero)
                                / 360.0)::INT) % (2 * generation.gen_height)::INT AS gen_replay_x,
                       (generation.gen_height / 2.0
                        - ROUND((generation.gen_height / 2.0) * residuals.pov_altitude / 90.0))::INT AS gen_replay_y
            ) AS gen_replay
            WHERE generation.gen_height <> residuals.height
                AND ABS((residuals.pano_x - gen_replay.gen_replay_x)
                        - 2 * generation.gen_height
                          * ROUND((residuals.pano_x - gen_replay.gen_replay_x)
                                  / (2 * generation.gen_height))) <= 1
                AND ABS(residuals.pano_y - gen_replay.gen_replay_y) <= 1
        )
), solved AS (
    -- Closed-form pitch: the ray's elevation f*sin(P) + dv*cos(P) must equal |ray| * sin(target altitude), where
    -- |ray| = sqrt(f^2 + du^2 + dv^2) is invariant in (heading, pitch). The WHERE is the asin domain guard -- it
    -- never fires on the study corpus, but an unrepairable row must be left alone, not crash the migration.
    SELECT mismatched.*,
           camera_heading + 180.0 + 360.0 * pano_x / width AS target_heading,
           DEGREES(ASIN(SQRT(f * f + du * du + dv * dv) * SIN(RADIANS(90.0 - 180.0 * pano_y / height))
                        / SQRT(f * f + dv * dv))
                   - ATAN2(dv, f)) AS new_pitch
    FROM mismatched
    WHERE ABS(SQRT(f * f + du * du + dv * dv) * SIN(RADIANS(90.0 - 180.0 * pano_y / height)))
        <= SQRT(f * f + dv * dv)
), repaired AS (
    -- Closed-form heading: the ray's azimuth is heading + atan2(du * sgn(cos P), f*cos(P) - dv*sin(P)), so aim the
    -- viewport at the target azimuth minus that canvas-offset term.
    SELECT solved.*,
           target_heading
               - DEGREES(ATAN2(du * (CASE WHEN COS(RADIANS(new_pitch)) >= 0 THEN 1.0 ELSE -1.0 END),
                               f * COS(RADIANS(new_pitch)) - dv * SIN(RADIANS(new_pitch)))) AS new_heading_raw
    FROM solved
)
INSERT INTO old_label_point_pov (label_id, old_heading, old_pitch, new_heading, new_pitch, old_render_error_px)
SELECT label_id,
       heading,
       pitch,
       new_heading_raw - 360.0 * FLOOR(new_heading_raw / 360.0),
       new_pitch,
       SQRT(POWER(abs_dx * 360.0 / width, 2) + POWER(abs_dy * 180.0 / height, 2)) / fov_deg * 720.0
FROM repaired;

UPDATE label_point
SET heading = old_label_point_pov.new_heading,
    pitch   = old_label_point_pov.new_pitch
FROM old_label_point_pov
WHERE label_point.label_id = old_label_point_pov.label_id;

-- Validation treatment (#4842, reviewed design). Votes on labels whose old record rendered >= 30 px off were
-- judgments of the wrong spot: below 30 px validator agreement sits at or above the 0.869 baseline, at 30-100 px it
-- drops to 0.830, and at >= 100 px it collapses to 0.606. We cannot know what those validators would have said about
-- the true position, so every vote on a >= 30 px repaired label is VOIDED -- flagged, never deleted (label_history
-- references validations, and the archived verdicts are themselves future study material). The labels' counts reset
-- and correct becomes NULL, so they re-enter the Validate queue rendering in the right place. Votes below 30 px are
-- kept -- the agreement data says those validators were not misled.
ALTER TABLE label_validation ADD COLUMN voided BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE old_label_validation_counts (
    label_id INTEGER NOT NULL,
    old_agree_count INTEGER NOT NULL,
    old_disagree_count INTEGER NOT NULL,
    old_unsure_count INTEGER NOT NULL,
    old_correct BOOLEAN,
    PRIMARY KEY (label_id),
    FOREIGN KEY (label_id) REFERENCES label (label_id)
);
ALTER TABLE old_label_validation_counts OWNER TO sidewalk;

-- Keyed on user_stat_id, not user_id: user_id carries no UNIQUE constraint and duplicate rows exist (#4776).
CREATE TABLE old_user_stat_validation (
    user_stat_id INTEGER NOT NULL,
    old_own_labels_validated INTEGER NOT NULL,
    old_accuracy DOUBLE PRECISION,
    old_high_quality BOOLEAN NOT NULL,
    PRIMARY KEY (user_stat_id),
    FOREIGN KEY (user_stat_id) REFERENCES user_stat (user_stat_id)
);
ALTER TABLE old_user_stat_validation OWNER TO sidewalk;

UPDATE label_validation
SET voided = TRUE
WHERE label_id IN (SELECT label_id FROM old_label_point_pov WHERE old_render_error_px >= 30);

INSERT INTO old_label_validation_counts (label_id, old_agree_count, old_disagree_count, old_unsure_count, old_correct)
SELECT label_id, agree_count, disagree_count, unsure_count, correct
FROM label
WHERE label_id IN (SELECT label_id FROM old_label_point_pov WHERE old_render_error_px >= 30)
    AND EXISTS (SELECT 1 FROM label_validation WHERE label_validation.label_id = label.label_id);

-- Every vote on these labels is now voided, so the recount from live votes is zero and correct is NULL (the same
-- derivation ValidationService.updateValidationCounts uses: agree > disagree -> TRUE, the reverse -> FALSE, tie or
-- no votes -> NULL). Zeroed counts put the labels at the front of the Validate queue's unvalidated priority.
UPDATE label
SET agree_count    = 0,
    disagree_count = 0,
    unsure_count   = 0,
    correct        = NULL
WHERE label_id IN (SELECT label_id FROM old_label_validation_counts);

INSERT INTO old_user_stat_validation (user_stat_id, old_own_labels_validated, old_accuracy, old_high_quality)
SELECT user_stat_id, own_labels_validated, accuracy, high_quality
FROM user_stat
WHERE user_id IN (
    SELECT DISTINCT label.user_id
    FROM label
    INNER JOIN old_label_validation_counts ON label.label_id = old_label_validation_counts.label_id
);

-- Re-derive the affected labelers' stats from the corrected label table. Mirrors UserStatTable.updateAccuracy.
UPDATE user_stat
SET own_labels_validated = recomputed.validated_count,
    accuracy             = recomputed.new_accuracy
FROM (
    SELECT label.user_id,
           COUNT(CASE WHEN label.correct IS NOT NULL THEN 1 END) AS validated_count,
           CAST(SUM(CASE WHEN label.correct THEN 1 ELSE 0 END) AS DOUBLE PRECISION)
               / NULLIF(SUM(CASE WHEN label.correct THEN 1 ELSE 0 END)
                        + SUM(CASE WHEN NOT label.correct THEN 1 ELSE 0 END), 0) AS new_accuracy
    FROM label
    WHERE label.deleted = FALSE
        AND label.tutorial = FALSE
        AND label.user_id IN (
            SELECT DISTINCT label.user_id
            FROM label
            INNER JOIN old_label_validation_counts ON label.label_id = old_label_validation_counts.label_id
        )
    GROUP BY label.user_id
) AS recomputed
WHERE user_stat.user_id = recomputed.user_id;

-- Accuracy feeds the quality heuristic, so refresh the flag for the same users. Mirrors evolution 347's scoped
-- rewrite of UserStatTable.updateHighQuality (a pure function of user_stat columns).
UPDATE user_stat
SET high_quality =
    NOT excluded
    AND COALESCE(high_quality_manual, TRUE)
    AND (COALESCE(high_quality_manual, FALSE)
         OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
             AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)))
WHERE user_stat_id IN (SELECT user_stat_id FROM old_user_stat_validation);


# --- !Downs
UPDATE user_stat
SET own_labels_validated = old_user_stat_validation.old_own_labels_validated,
    accuracy             = old_user_stat_validation.old_accuracy,
    high_quality         = old_user_stat_validation.old_high_quality
FROM old_user_stat_validation
WHERE user_stat.user_stat_id = old_user_stat_validation.user_stat_id;

UPDATE label
SET agree_count    = old_label_validation_counts.old_agree_count,
    disagree_count = old_label_validation_counts.old_disagree_count,
    unsure_count   = old_label_validation_counts.old_unsure_count,
    correct        = old_label_validation_counts.old_correct
FROM old_label_validation_counts
WHERE label.label_id = old_label_validation_counts.label_id;

ALTER TABLE label_validation DROP COLUMN voided;

UPDATE label_point
SET heading = old_label_point_pov.old_heading,
    pitch   = old_label_point_pov.old_pitch
FROM old_label_point_pov
WHERE label_point.label_id = old_label_point_pov.label_id;

DROP TABLE old_user_stat_validation;
DROP TABLE old_label_validation_counts;
DROP TABLE old_label_point_pov;
