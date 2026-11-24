-- =====================================================================================================================
-- seed-city-rows.sql — the rows every city needs that an evolution wrote once and no script derives.
--
-- WHY THIS EXISTS: a new city is cloned with its donor's play_evolutions, so the evolutions that seeded these rows
-- (360.sql, 281.sql) never run on it. Their tables also fill with QA data, so the launch dump cannot simply keep
-- them. create-new-schema.sh runs this on the fresh clone, and setup_new_city.py's dump_schema on the copy it ships.
--
-- HOW IT'S RUN:  psql -v ON_ERROR_STOP=1 -U postgres -d sidewalk -v schema=<schema> -f seed-city-rows.sql
-- Safe to rerun: every statement skips the rows already there.
-- =====================================================================================================================
SET search_path TO :"schema", sidewalk_login, public;

-- Tutorial labels carry no pano metadata, so without these rows the first one fails label_pano_id_fkey (#6036).
-- last_checked is 360.sql's date, which its Down uses to tell its own rows apart.
INSERT INTO pano_data (pano_id, width, height, tile_width, tile_height, capture_date, copyright, lat, lng,
                       camera_heading, camera_pitch, source, last_checked)
VALUES ('tutorial', 4096, 2048, 2048, 1024, '2014-05', 'Imagery (c) 2010 Google',
        38.94042608, -77.06766133, 50.3866, 1.13769, 'tutorial', '2026-08-21'),
       ('afterWalkTutorial', 3400, 1700, 1700, 850, '2014-05', 'Imagery (c) 2010 Google',
        38.94061618, -77.06768201, 344, 0, 'tutorial', '2026-08-21')
ON CONFLICT (pano_id) DO NOTHING;

-- The SidewalkAI account never signs in, so nothing else makes its user_stat row, and without one the AI's labels
-- are invisible (#5349). high_quality_manual keeps the AI from being filtered out as low quality.
INSERT INTO user_stat (user_id, high_quality, high_quality_manual, excluded)
VALUES ('51b0b927-3c8a-45b2-93de-bd878d1e5cf4', TRUE, TRUE, FALSE)
ON CONFLICT (user_id) DO NOTHING;

-- Every AI validation attaches to the open aiValidation mission for its label's type, and throws without one.
INSERT INTO mission (mission_type, user_id, labels_validated, labels_progress, label_type)
SELECT 'aiValidation', '51b0b927-3c8a-45b2-93de-bd878d1e5cf4', 1, 0, ai_label_type
FROM unnest(enum_range(NULL::label_type)) AS ai_label_type
WHERE NOT EXISTS (
    SELECT 1 FROM mission
    WHERE mission.user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4'
        AND mission.mission_type = 'aiValidation'
        AND mission.label_type = ai_label_type
);
