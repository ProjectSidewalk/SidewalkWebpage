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
    -- validation voiding below and makes the repair auditable per label. The metric is the study instrument's,
    -- verbatim (era_replay_study dx_deg/dy_deg -> validate_px in sidewalk-panorama-tools): equirectangular px
    -- scaled by 360/width and 180/height, hypot, then / fov * 720. Deliberately no cos(altitude) factor on the
    -- x term -- the instrument's metric has none, and the 30 px cutoff was read off that instrument's
    -- agreement-vs-error curve, so adding one here would decalibrate the threshold (it would also only shrink
    -- the error, i.e. void fewer votes, never more).
    old_render_error_px DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (label_id),
    FOREIGN KEY (label_id) REFERENCES label (label_id),
    CHECK (old_render_error_px >= 0),
    -- The solver normalizes heading into [0, 360) and a physical viewport pitch lies in [-90, 90], so an
    -- out-of-range value can only mean a solver bug. Fail the evolution loudly rather than store a bad repair.
    CHECK (new_heading >= 0 AND new_heading < 360),
    CHECK (new_pitch >= -90 AND new_pitch <= 90)
);
ALTER TABLE old_label_point_pov OWNER TO sidewalk;

-- One pass computes everything: replay the stored record (pov_inputs -> ray -> replayed -> residuals), keep the
-- rows that miss their own coordinate by > 2 px and are not frame changes (mismatched), then re-solve the viewport
-- (solved -> repaired). The projection constants are the 720x480 Explore canvas (center 360, 240) and get3dFov's
-- zoom ladder, exactly as in evolution 179. Rounding is NOT bit-identical to the client and does not need to be:
-- Postgres ROUND(double precision) is half-to-even where the client's Math.round is half-up, and the client wraps x
-- into [0, width) before rounding where this replay rounds first (so a stored pano_x can legitimately be exactly
-- width). Both differences are at most 1 px and are absorbed by the > 2 px threshold and the seam-aware abs_dx.
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
        AND pano_data.height > 0
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
    -- The four generation heights are the certified study instrument's list, verbatim (sidewalk-panorama-tools
    -- PR #80) -- the same allowlist the 438k-label era-replay study and the all-cities census ran with, which is
    -- what makes detection here comparable to the published numbers the voiding thresholds rest on. Dev-DB re-runs
    -- with a data-derived height list produced identical detection counts on Teaneck and Seattle, so an uncovered
    -- generation is a theoretical gap today. Expand the list only in lockstep with the instrument (plus a re-run of
    -- the affected-cohort census), never here alone.
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
    --
    -- Branch choice is free, and that is load-bearing: the principal ASIN branch picks ONE of the (heading, pitch)
    -- pairs that aim the record's canvas ray at the target, which suffices because no consumer renders the raw
    -- record POV. Validate, Gallery, and label-detail all re-center the viewport through
    -- util.pano.canvasCoordToCenteredPov(record POV, canvas_x, canvas_y) (panoUtilities.js), whose output depends
    -- on the record only through that ray direction -- so every solution aiming at the target renders identically.
    -- If a consumer ever starts rendering record heading/pitch directly, branch choice starts to matter.
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

-- Self-check: re-replay every repaired record through the identical projection above and assert it now lands on its
-- own pano_x/pano_y. The scaffold table's CHECK is the assert -- autocommit=false makes the whole evolution one
-- transaction, so a single failing row aborts and rolls everything back instead of shipping a wrong repair. The
-- table is dropped at the end of the Ups. It exists so every unattended application of this evolution (54 prod
-- schemas) verifies its own repairs, not just the dev runs someone watched.
CREATE TABLE pov_repair_check (
    label_id INTEGER NOT NULL,
    -- Residual of the repaired record against the label's own coordinate, in pano px (seam-aware on x, worst axis).
    -- 2 px is the detection pass's own rounding-noise bound. The closed forms re-solve the coordinate exactly, so
    -- anything beyond rounding noise can only be a solver bug -- fail the evolution loudly.
    residual_px DOUBLE PRECISION NOT NULL,
    CHECK (residual_px <= 2)
);
ALTER TABLE pov_repair_check OWNER TO sidewalk;

WITH pov_inputs AS (
    -- Same projection inputs as the detection pass, but reading the REPAIRED heading/pitch just written above,
    -- restricted to exactly the repaired rows.
    SELECT old_label_point_pov.label_id,
           label_point.pano_x,
           label_point.pano_y,
           pano_data.camera_heading,
           pano_data.width::DOUBLE PRECISION AS width,
           pano_data.height::DOUBLE PRECISION AS height,
           360.0 / TAN(0.5 * RADIANS(CASE WHEN label_point.zoom <= 2 THEN 126.5 - 36.75 * label_point.zoom
                                          ELSE 195.93 / POWER(1.92, label_point.zoom) END)) AS f,
           (label_point.canvas_x - 360)::DOUBLE PRECISION AS du,
           (240 - label_point.canvas_y)::DOUBLE PRECISION AS dv,
           RADIANS(label_point.heading) AS heading_rad,
           RADIANS(label_point.pitch) AS pitch_rad
    FROM old_label_point_pov
    INNER JOIN label ON old_label_point_pov.label_id = label.label_id
    INNER JOIN label_point ON label.label_id = label_point.label_id
    INNER JOIN pano_data ON label.pano_id = pano_data.pano_id
), ray AS (
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
    SELECT ray.*,
           DEGREES(ATAN2(ray_x, ray_y)) + CASE WHEN ATAN2(ray_x, ray_y) < 0 THEN 360.0 ELSE 0.0 END AS pov_heading,
           DEGREES(ASIN(ray_z / SQRT(ray_x * ray_x + ray_y * ray_y + ray_z * ray_z))) AS pov_altitude,
           camera_heading + 180.0 - 360.0 * FLOOR((camera_heading + 180.0) / 360.0) AS heading_pixel_zero
    FROM ray
)
INSERT INTO pov_repair_check (label_id, residual_px)
SELECT label_id,
       GREATEST(
           ABS((pano_x - ((width::INT + ROUND(width * (pov_heading - heading_pixel_zero) / 360.0)::INT) % width::INT))
               - width * ROUND((pano_x
                                - ((width::INT + ROUND(width * (pov_heading - heading_pixel_zero) / 360.0)::INT)
                                   % width::INT)) / width)),
           ABS(pano_y - (height / 2.0 - ROUND((height / 2.0) * pov_altitude / 90.0))::INT))
FROM replayed;

DROP TABLE pov_repair_check;

-- Validation treatment (#4842, design v2 from the PR #4866 review). Votes on labels whose old record rendered
-- >= 30 px off were judgments of the wrong spot: below 30 px validator agreement sits at or above the 0.869 baseline,
-- at 30-100 px it drops to 0.830, and at >= 100 px it collapses to 0.606. We cannot know what those validators would
-- have said about the true position, so every HUMAN vote on a >= 30 px repaired label is deleted and archived in
-- voided_label_validation (the archived verdicts remain study material, and the freed unique slot lets the validator
-- be re-served the label rendering in the right place). AI votes survive: the AI is pointed at the label via
-- normalized pano_x/pano_y (AiService), the coordinate side that stayed true throughout the bug window, so its
-- judgments were never misled by the stale record. Each affected label's counts and correct are then RECOMPUTED from
-- its surviving votes -- zeros/NULL where none survive, which re-enters the label in the Validate queue. Votes below
-- 30 px are kept: the agreement data says those validators were not misled.
CREATE TABLE voided_label_validation (
    label_validation_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    validation_result validation_option NOT NULL,
    user_id TEXT NOT NULL,
    mission_id INTEGER NOT NULL,
    canvas_x INTEGER,
    canvas_y INTEGER,
    heading DOUBLE PRECISION NOT NULL,
    pitch DOUBLE PRECISION NOT NULL,
    zoom DOUBLE PRECISION NOT NULL,
    canvas_height INTEGER NOT NULL,
    canvas_width INTEGER NOT NULL,
    start_timestamp TIMESTAMPTZ NOT NULL,
    end_timestamp TIMESTAMPTZ NOT NULL,
    source ui_source NOT NULL,
    old_severity INTEGER,
    new_severity INTEGER,
    old_tags TEXT[] NOT NULL,
    new_tags TEXT[] NOT NULL,
    viewer_type viewer_type NOT NULL,
    -- On-screen error of the label's OLD record: the reason this vote was voided.
    old_render_error_px DOUBLE PRECISION NOT NULL,
    -- The label_ai_assessment row that referenced this vote before its FK was nulled, if any (expected ~0:
    -- assessments attach to AI validations, which survive). Lets the Downs restore the linkage exactly.
    label_ai_assessment_id INTEGER,
    -- The vote's label_history row, captured verbatim where one exists (all three NULL otherwise): the row's PK,
    -- its now()-stamped edit_time, and its CLEANED tag list (new_tags above is the raw client list). The severity
    -- and remaining fields are already carried by the vote's own columns, so with these three the Downs
    -- regenerates the row byte-identically instead of approximating edit_time with end_timestamp.
    old_history_id INTEGER,
    old_history_edit_time TIMESTAMPTZ,
    old_history_tags TEXT[],
    PRIMARY KEY (label_validation_id),
    FOREIGN KEY (label_id) REFERENCES label (label_id),
    FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user (user_id),
    FOREIGN KEY (mission_id) REFERENCES mission (mission_id),
    FOREIGN KEY (label_ai_assessment_id) REFERENCES label_ai_assessment (label_ai_assessment_id),
    UNIQUE (user_id, label_id),
    CHECK (old_severity IS NULL OR old_severity BETWEEN 1 AND 3),
    CHECK (new_severity IS NULL OR new_severity BETWEEN 1 AND 3),
    CHECK (old_render_error_px >= 30),
    -- The three history-capture columns describe one row: all present or all absent.
    CHECK ((old_history_id IS NULL) = (old_history_edit_time IS NULL)
           AND (old_history_id IS NULL) = (old_history_tags IS NULL))
);
ALTER TABLE voided_label_validation OWNER TO sidewalk;

-- Archive for label_history rows deleted by the consistency pass below that are NOT regenerable from
-- voided_label_validation: rows that became no-op entries (state equal to their predecessor) once the voided votes'
-- own history rows were removed. They are real edits by surviving sources, so without this archive the Downs replay
-- would restore the wrong label state. Expected row count is zero on every measured deployment.
--
-- Deliberately no Slick model (unlike voided_label_validation, which the app reads for work credit): the app never
-- reads this table -- it exists solely so the Downs can restore surviving-source edits, and mirroring rollback
-- scaffolding in code would invite app reads of it.
CREATE TABLE voided_label_history (
    label_history_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    severity INTEGER,
    tags TEXT[] NOT NULL,
    edited_by TEXT NOT NULL,
    edit_time TIMESTAMPTZ NOT NULL,
    source ui_source NOT NULL,
    label_validation_id INTEGER,
    PRIMARY KEY (label_history_id),
    FOREIGN KEY (label_id) REFERENCES label (label_id),
    FOREIGN KEY (edited_by) REFERENCES sidewalk_login.sidewalk_user (user_id),
    -- These rows only ever reference surviving (non-voided) votes -- the voided votes' history rows are deleted by
    -- label_validation_id before this pass runs -- so the FK holds, and it would loudly block a bug that broke that.
    FOREIGN KEY (label_validation_id) REFERENCES label_validation (label_validation_id),
    CHECK (severity IS NULL OR severity BETWEEN 1 AND 3)
);
ALTER TABLE voided_label_history OWNER TO sidewalk;

-- Human votes only: SidewalkAI submissions are excluded by source, and (belt-and-suspenders) so is anything by an
-- AI-role user -- the two definitions agree on all measured data, so the second clause is a guard, not a filter.
-- The LEFT JOINs to label_history / label_ai_assessment stand in for per-row scalar subqueries, and the archive's
-- PRIMARY KEY doubles as the one-to-one assert: a vote carrying two history rows or referenced by two assessments
-- would fan out to two INSERT rows and fail the evolution loudly on the PK, instead of archiving half a mapping.
INSERT INTO voided_label_validation (label_validation_id, label_id, validation_result, user_id, mission_id, canvas_x,
                                     canvas_y, heading, pitch, zoom, canvas_height, canvas_width, start_timestamp,
                                     end_timestamp, source, old_severity, new_severity, old_tags, new_tags, viewer_type,
                                     old_render_error_px, label_ai_assessment_id, old_history_id,
                                     old_history_edit_time, old_history_tags)
SELECT label_validation.label_validation_id, label_validation.label_id, label_validation.validation_result,
       label_validation.user_id, label_validation.mission_id, label_validation.canvas_x, label_validation.canvas_y,
       label_validation.heading, label_validation.pitch, label_validation.zoom, label_validation.canvas_height,
       label_validation.canvas_width, label_validation.start_timestamp, label_validation.end_timestamp,
       label_validation.source, label_validation.old_severity, label_validation.new_severity,
       label_validation.old_tags, label_validation.new_tags, label_validation.viewer_type,
       old_label_point_pov.old_render_error_px,
       label_ai_assessment.label_ai_assessment_id,
       label_history.label_history_id,
       label_history.edit_time,
       label_history.tags
FROM label_validation
INNER JOIN old_label_point_pov ON label_validation.label_id = old_label_point_pov.label_id
LEFT JOIN label_ai_assessment ON label_ai_assessment.label_validation_id = label_validation.label_validation_id
LEFT JOIN label_history ON label_history.label_validation_id = label_validation.label_validation_id
WHERE old_label_point_pov.old_render_error_px >= 30
    AND label_validation.source <> 'SidewalkAI'
    AND NOT EXISTS (
        SELECT 1
        FROM sidewalk_login.user_role
        INNER JOIN sidewalk_login.role ON user_role.role_id = role.role_id
        WHERE role.role = 'AI'
            AND user_role.user_id = label_validation.user_id
    );

-- The voided votes' own history rows are fully carried by the archive (the votes' old_/new_ columns plus the
-- captured old_history_* triple), so the Downs regenerates them byte-identically.
DELETE FROM label_history
WHERE label_validation_id IN (SELECT label_validation_id FROM voided_label_validation);

-- History-consistency pass (the pattern from evolutions 247/248/253, scoped to the affected labels): archive, then
-- delete, entries that no longer represent a change now that the voided edits are gone. IS NOT DISTINCT FROM instead
-- of = because severity is nullable and two consecutive NULL-severity states are the same state. A label's first
-- history row always survives (its predecessor is NULL, and tags is NOT NULL, so the equality can't hold).
INSERT INTO voided_label_history (label_history_id, label_id, severity, tags, edited_by, edit_time, source,
                                  label_validation_id)
SELECT label_history_id, label_id, severity, tags, edited_by, edit_time, source, label_validation_id
FROM (
    SELECT label_history.label_history_id, label_history.label_id, label_history.severity, label_history.tags,
           label_history.edited_by, label_history.edit_time, label_history.source, label_history.label_validation_id,
           LAG(label_history.severity) OVER (PARTITION BY label_history.label_id
                                             ORDER BY label_history.edit_time, label_history.label_history_id)
               AS prev_severity,
           LAG(label_history.tags) OVER (PARTITION BY label_history.label_id
                                         ORDER BY label_history.edit_time, label_history.label_history_id)
               AS prev_tags
    FROM label_history
    WHERE label_history.label_id IN (SELECT DISTINCT label_id FROM voided_label_validation)
) AS with_previous
WHERE severity IS NOT DISTINCT FROM prev_severity
    AND tags = prev_tags;

DELETE FROM label_history
WHERE label_history_id IN (SELECT label_history_id FROM voided_label_history);

-- Revert affected labels' severity/tags by replaying what survives: a label's current state is by invariant its
-- latest history entry, so labels whose stream lost rows snap back to the latest surviving entry. Scoped to labels
-- whose history stream ACTUALLY lost a row (a voided vote that carried a history row, or a consistency-pass
-- deletion), not every voided-vote label -- on a label whose stream is untouched this would otherwise "replay" any
-- pre-existing drift between label and its history, rewriting state the repair never disturbed.
UPDATE label
SET severity = latest_history.severity,
    tags     = latest_history.tags
FROM (
    SELECT DISTINCT ON (label_id) label_id, severity, tags
    FROM label_history
    WHERE label_id IN (
        SELECT label_id FROM voided_label_validation WHERE old_history_id IS NOT NULL
        UNION
        SELECT label_id FROM voided_label_history
    )
    ORDER BY label_id, edit_time DESC, label_history_id DESC
) AS latest_history
WHERE label.label_id = latest_history.label_id
    AND (label.severity IS DISTINCT FROM latest_history.severity OR label.tags <> latest_history.tags);

-- Assessments are model outputs -- source data -- so they are kept. Only the reference to a deleted vote is nulled,
-- with the mapping preserved on the archive row for the Downs.
UPDATE label_ai_assessment
SET label_validation_id = NULL
WHERE label_validation_id IN (SELECT label_validation_id FROM voided_label_validation);

DELETE FROM label_validation
WHERE label_validation_id IN (SELECT label_validation_id FROM voided_label_validation);

-- Recompute each affected label's counts and correct from its surviving votes, with the same per-vote predicate the
-- runtime increments use (ValidationService.insert): self-validations and votes by excluded users never count.
-- Correct mirrors updateValidationCounts: agree > disagree -> TRUE, the reverse -> FALSE, tie or no votes -> NULL.
UPDATE label
SET agree_count    = recount.agree_count,
    disagree_count = recount.disagree_count,
    unsure_count   = recount.unsure_count,
    correct        = CASE WHEN recount.agree_count > recount.disagree_count THEN TRUE
                          WHEN recount.disagree_count > recount.agree_count THEN FALSE
                          END
FROM (
    SELECT label.label_id,
           COUNT(label_validation.label_validation_id)
               FILTER (WHERE label_validation.validation_result = 'Agree')::INT    AS agree_count,
           COUNT(label_validation.label_validation_id)
               FILTER (WHERE label_validation.validation_result = 'Disagree')::INT AS disagree_count,
           COUNT(label_validation.label_validation_id)
               FILTER (WHERE label_validation.validation_result = 'Unsure')::INT   AS unsure_count
    FROM label
    LEFT JOIN label_validation ON label.label_id = label_validation.label_id
        AND label_validation.user_id <> label.user_id
        AND NOT EXISTS (SELECT 1 FROM user_stat
                        WHERE user_stat.user_id = label_validation.user_id AND user_stat.excluded)
    WHERE label.label_id IN (SELECT DISTINCT label_id FROM voided_label_validation)
    GROUP BY label.label_id
) AS recount
WHERE label.label_id = recount.label_id;

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
    INNER JOIN (
        SELECT DISTINCT label.user_id
        FROM label
        INNER JOIN voided_label_validation ON label.label_id = voided_label_validation.label_id
    ) AS affected_labeler ON label.user_id = affected_labeler.user_id
    WHERE label.deleted = FALSE
        AND label.tutorial = FALSE
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
FROM (
    SELECT DISTINCT label.user_id
    FROM label
    INNER JOIN voided_label_validation ON label.label_id = voided_label_validation.label_id
) AS affected_labeler
WHERE user_stat.user_id = affected_labeler.user_id;


# --- !Downs

-- Restore the archived votes. Deliberately NO ON CONFLICT: if a validator re-validated a label post-evolution,
-- their new vote holds the (user_id, label_id) slot, and any conflict-handling here would have to silently discard
-- an archived verdict -- data this project treats as sacrosanct. The plain INSERT makes that collision fail the
-- rollback loudly (label_validation_user_id_label_id_unique) so a human decides which vote survives: delete the
-- losing row, then re-run the Downs. Every statement below can therefore assume all archived votes are back.
INSERT INTO label_validation (label_validation_id, label_id, validation_result, user_id, mission_id, canvas_x,
                              canvas_y, heading, pitch, zoom, canvas_height, canvas_width, start_timestamp,
                              end_timestamp, source, old_severity, new_severity, old_tags, new_tags, viewer_type)
SELECT label_validation_id, label_id, validation_result, user_id, mission_id, canvas_x, canvas_y, heading, pitch,
       zoom, canvas_height, canvas_width, start_timestamp, end_timestamp, source, old_severity, new_severity,
       old_tags, new_tags, viewer_type
FROM voided_label_validation;

-- Regenerate the votes' history rows byte-identically from the captured triple: original PK (freed by the Ups and
-- never reused by the sequence), original now()-stamped edit_time, and the cleaned tag list the row actually
-- carried. Severity and the remaining fields ride on the vote's own columns.
INSERT INTO label_history (label_history_id, label_id, severity, tags, edited_by, edit_time, source,
                           label_validation_id)
SELECT old_history_id, label_id, new_severity, old_history_tags, user_id, old_history_edit_time, source,
       label_validation_id
FROM voided_label_validation
WHERE old_history_id IS NOT NULL;

-- Restore the consistency-pass rows exactly (IDs preserved -- they were freed by the Ups and the sequence never
-- reuses them).
INSERT INTO label_history (label_history_id, label_id, severity, tags, edited_by, edit_time, source,
                           label_validation_id)
SELECT label_history_id, label_id, severity, tags, edited_by, edit_time, source, label_validation_id
FROM voided_label_history;

-- Re-apply severity/tags by the same replay the Ups used: with the history rows back, each affected label snaps to
-- its latest entry. Post-evolution edits are newer than anything restored, so they stay in effect. Same
-- lost-a-row scoping as the Ups, for the same reason: never touch a label whose history stream this evolution
-- didn't change.
UPDATE label
SET severity = latest_history.severity,
    tags     = latest_history.tags
FROM (
    SELECT DISTINCT ON (label_id) label_id, severity, tags
    FROM label_history
    WHERE label_id IN (
        SELECT label_id FROM voided_label_validation WHERE old_history_id IS NOT NULL
        UNION
        SELECT label_id FROM voided_label_history
    )
    ORDER BY label_id, edit_time DESC, label_history_id DESC
) AS latest_history
WHERE label.label_id = latest_history.label_id
    AND (label.severity IS DISTINCT FROM latest_history.severity OR label.tags <> latest_history.tags);

-- Restore the nulled label_ai_assessment references from the archived mapping.
UPDATE label_ai_assessment
SET label_validation_id = voided_label_validation.label_validation_id
FROM voided_label_validation
WHERE voided_label_validation.label_ai_assessment_id = label_ai_assessment.label_ai_assessment_id;

-- Recompute counts, correct, and user stats with the votes back -- the same derivations as the Ups, never a
-- snapshot restore, so votes cast after the evolution keep their effect.
UPDATE label
SET agree_count    = recount.agree_count,
    disagree_count = recount.disagree_count,
    unsure_count   = recount.unsure_count,
    correct        = CASE WHEN recount.agree_count > recount.disagree_count THEN TRUE
                          WHEN recount.disagree_count > recount.agree_count THEN FALSE
                          END
FROM (
    SELECT label.label_id,
           COUNT(label_validation.label_validation_id)
               FILTER (WHERE label_validation.validation_result = 'Agree')::INT    AS agree_count,
           COUNT(label_validation.label_validation_id)
               FILTER (WHERE label_validation.validation_result = 'Disagree')::INT AS disagree_count,
           COUNT(label_validation.label_validation_id)
               FILTER (WHERE label_validation.validation_result = 'Unsure')::INT   AS unsure_count
    FROM label
    LEFT JOIN label_validation ON label.label_id = label_validation.label_id
        AND label_validation.user_id <> label.user_id
        AND NOT EXISTS (SELECT 1 FROM user_stat
                        WHERE user_stat.user_id = label_validation.user_id AND user_stat.excluded)
    WHERE label.label_id IN (SELECT DISTINCT label_id FROM voided_label_validation)
    GROUP BY label.label_id
) AS recount
WHERE label.label_id = recount.label_id;

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
    INNER JOIN (
        SELECT DISTINCT label.user_id
        FROM label
        INNER JOIN voided_label_validation ON label.label_id = voided_label_validation.label_id
    ) AS affected_labeler ON label.user_id = affected_labeler.user_id
    WHERE label.deleted = FALSE
        AND label.tutorial = FALSE
    GROUP BY label.user_id
) AS recomputed
WHERE user_stat.user_id = recomputed.user_id;

UPDATE user_stat
SET high_quality =
    NOT excluded
    AND COALESCE(high_quality_manual, TRUE)
    AND (COALESCE(high_quality_manual, FALSE)
         OR ((meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
             AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)))
FROM (
    SELECT DISTINCT label.user_id
    FROM label
    INNER JOIN voided_label_validation ON label.label_id = voided_label_validation.label_id
) AS affected_labeler
WHERE user_stat.user_id = affected_labeler.user_id;

DROP TABLE voided_label_history;
DROP TABLE voided_label_validation;

UPDATE label_point
SET heading = old_label_point_pov.old_heading,
    pitch   = old_label_point_pov.old_pitch
FROM old_label_point_pov
WHERE label_point.label_id = old_label_point_pov.label_id;

DROP TABLE old_label_point_pov;
