-- 360 makes label.pano_id -> pano_data structural. 975 DC labels (2015-2020) on 343 panos never got a gsv_data
-- row -- the same "label saved before its pano metadata" leak 360 describes, which on prod it patches with a
-- hardcoded list of recovered panos. For DC, recover what the legacy data still holds: 179's old_label_metadata
-- kept each label's pano position and camera angles, so every missing pano gets a row carrying those (from its
-- most recent label), no dimensions (DC has none anywhere; the post-migration metadata refetch fills them), and
-- last_viewed/last_checked = the last time it was labeled, so the imagery-expiry poll treats it as unchecked
-- since then. The list is kept in dc_migration_stub_pano for the report (issue #4700).
CREATE TABLE dc_migration_stub_pano AS
SELECT DISTINCT ON (label.pano_id)
       label.pano_id, label.label_id AS from_label_id, label.time_created,
       old_label_metadata.old_pano_lat AS lat, old_label_metadata.old_pano_lng AS lng,
       old_label_metadata.old_camera_heading AS camera_heading, old_label_metadata.old_camera_pitch AS camera_pitch
FROM label
LEFT JOIN old_label_metadata ON old_label_metadata.label_id = label.label_id
WHERE NOT EXISTS (SELECT 1 FROM pano_data WHERE pano_data.pano_id = label.pano_id)
ORDER BY label.pano_id, label.time_created DESC NULLS LAST;

INSERT INTO pano_data (pano_id, capture_date, expired, last_viewed, last_checked, source, lat, lng, camera_heading, camera_pitch)
SELECT pano_id, '', FALSE, COALESCE(time_created, now()), COALESCE(time_created, now()), 'gsv',
       lat, lng,
       CASE WHEN camera_heading = 'NaN' THEN NULL ELSE camera_heading END,
       CASE WHEN camera_pitch = 'NaN' THEN NULL ELSE camera_pitch END
FROM dc_migration_stub_pano;

SELECT 'stub panos inserted' AS what, count(*), count(lat) AS with_position FROM dc_migration_stub_pano;
