-- =====================================================================================================================
-- The test city CI runs against (sidewalk_teaneck): real prod rows for region 18 (Tyron Park) -- its
-- streets, labels and panoramas. GENERATED: edit tools/gen_ci_seed.py and re-run it, not this file (#5115). The
-- slice it reads comes from tools/ci_seed_slice.sql, which records which rows were taken and why those.
--
-- Real data, because a fixture that invents its own coordinates and panorama ids can only show that the code runs,
-- not that it runs on the shape of data it will meet.
--
-- Applied by ci.yml in BOTH the e2e-smoke job (after the app boots) and backend-tests (after its evolutions step),
-- always once the schema is at evolution HEAD: it writes street_edge.status and its ON CONFLICT targets need
-- constraints the committed template lacks. Idempotent, so a job retry can re-run it.
--
-- Four deliberate departures from prod:
--   * NO FREE TEXT. Label descriptions and validator comments are contributor-authored and this repo is public, so
--     the slice query never selected them; the strings below are written here instead.
--   * USERS ARE SYNTHETIC. A contributor's account is not ours to copy, and nothing here reads more than its role.
--   * GEOMETRY IS SIMPLIFIED (topology-preserving, so endpoints still agree with x1/y1/x2/y2): ~50 m for the region
--     boundary, ~2 m for the streets. A raw boundary is thousands of vertices no one can read in a diff.
--   * IMAGERY IS DOWNSCALED to 1024x512 and pano_data.width/height say so, because that is the size of the copy in
--     test/e2e/fixtures/media: those columns describe the imagery we hold, and a full-resolution one is ~15 MB.
--     label_point.pano_x/pano_y are rescaled by the same factor, since they index that same panorama -- rawLabels
--     publishes the four side by side for clients to use together, so a mismatched row would be a broken one.
--
-- EVERY PANORAMA IS EXPIRED, which is what keeps the server side hermetic: an expired pano is never fetched from a
-- provider, so nothing here depends on Google still serving a 2022 panorama or on a GOOGLE_MAPS_SECRET CI does not
-- have (#4948). What stands in is on disk, via install-media.sh -- keep the two in step.
--
-- Label ids are renumbered into a 900000 block and the sequences are deliberately NOT advanced past them: specs
-- insert from those same low sequences all run long, and `getRecentLabelsMetadata` orders by `label_id DESC`, so a
-- seeded label is only visible to the share and story specs while its id sits above every id the suite mints. The
-- prod id beside each one is also what its crop file was renamed from.
--
-- Cached columns (user_stat.meters_audited, labels_per_meter, high_quality, region_completion,
-- route.distance_meters) are COMPUTED at the end by the same rules their runtime recomputes use, never hardcoded:
-- GeodesicDistanceSpec asserts exactly that agreement.
-- =====================================================================================================================

-- With zero region rows /explore is a server error before any JS runs (#4748). With one, a fresh anonymous user
-- deterministically starts the audit TUTORIAL, whose panorama tiles are local assets.
INSERT INTO sidewalk_teaneck.region (region_id, data_source, name, geom, deleted)
VALUES (18, 'https://njogis-newjersey.opendata.arcgis.com/datasets/764362ac87254d77b976a080f926a6fe_0/explore?filters=eyJNVU5fTkFNRSI6WyJUZWFuZWNrIFRvd25zaGlwIl19', 'Tyron Park',
        ST_Multi(ST_GeomFromText(
          'MULTIPOLYGON(((-73.98971375699995 40.90241892900008,-73.99085302299994 40.898414425000055,-73.99939745799998 40.90137849300004,-73.99883345799998 40.906239295000034,-73.98933808399994 40.908536371000025,-73.98971375699995 40.90241892900008)))', 4326)),
        FALSE)
ON CONFLICT (region_id) DO NOTHING;

-- The template's own street 1 stays out of the region: it is the tutorial street, which region completion excludes,
-- so a region holding only it counts as vacuously complete for everyone and is never assigned -- the same 500 as
-- having no region at all.
INSERT INTO sidewalk_teaneck.street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status)
VALUES
  (479, ST_GeomFromText('LINESTRING(-73.99309 40.90276,-73.9922537 40.9038259)', 4326),
   -73.99309, 40.90276, -73.9922537, 40.9038259, 'residential', 'open'),  -- 137.76 m
  (842, ST_GeomFromText('LINESTRING(-73.991975 40.900626,-73.991578 40.9013)', 4326),
   -73.991975, 40.900626, -73.991578, 40.9013, 'residential', 'open'),  -- 81.98 m
  (1141, ST_GeomFromText('LINESTRING(-73.998832 40.906231,-73.995232 40.906837)', 4326),
   -73.998832, 40.906231, -73.995232, 40.906837, 'residential', 'open'),  -- 310.69 m
  (1334, ST_GeomFromText('LINESTRING(-73.991998 40.90668,-73.991123 40.90683)', 4326),
   -73.991998, 40.90668, -73.991123, 40.90683, 'residential', 'open')  -- 75.58 m
ON CONFLICT (street_edge_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.street_edge_region (street_edge_id, region_id)
SELECT s.street_edge_id, 18
FROM (VALUES (479), (842), (1141), (1334)) AS s(street_edge_id)
WHERE NOT EXISTS (
  SELECT 1 FROM sidewalk_teaneck.street_edge_region WHERE street_edge_id = s.street_edge_id
);

-- Priorities below 1.0 mark a street as explored at least once, which is what gives region_completion a non-zero
-- audited distance and the API and landing page a completion percentage that is not flat zero.
INSERT INTO sidewalk_teaneck.street_edge_priority (street_edge_id, priority)
VALUES (479, 0.4), (842, 1.0), (1141, 0.7), (1334, 0.55)
ON CONFLICT (street_edge_id) DO NOTHING;

-- Users. `sidewalk_login` is shared across every city schema, not this city's -- fine only because CI's database is
-- thrown away with the job, and this file runs nowhere else. The Administrator is for RouteAuthPostureSpec, which
-- reads an existing admin's email and mints its own session cookie, so no password rows are needed.
INSERT INTO sidewalk_login.sidewalk_user (user_id, username, email)
VALUES
  ('00000000-5115-4000-8000-000000000001', 'ciSeedAdmin',    'ci-seed-admin@example.test'),
  ('00000000-5115-4000-8000-000000000002', 'ciSeedLabeler1', 'ci-seed-labeler-1@example.test'),
  ('00000000-5115-4000-8000-000000000003', 'ciSeedLabeler2', 'ci-seed-labeler-2@example.test'),
  ('00000000-5115-4000-8000-000000000004', 'ciSeedLabeler3', 'ci-seed-labeler-3@example.test')
ON CONFLICT (user_id) DO NOTHING;

-- user_role's only unique key is its own id, so this guards on the user instead of ON CONFLICT.
INSERT INTO sidewalk_login.user_role (user_role_id, user_id, role)
SELECT r.user_role_id, r.user_id, r.role::sidewalk_login.role
FROM (VALUES (900001, '00000000-5115-4000-8000-000000000001', 'Administrator'),
             (900002, '00000000-5115-4000-8000-000000000002', 'Registered'),
             (900003, '00000000-5115-4000-8000-000000000003', 'Registered'),
             (900004, '00000000-5115-4000-8000-000000000004', 'Registered')) AS r(user_role_id, user_id, role)
WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.user_role WHERE user_role.user_id = r.user_id);

-- meters_audited / labels_per_meter / high_quality are filled in at the end, once their inputs exist.
INSERT INTO sidewalk_teaneck.user_stat (user_stat_id, user_id, meters_audited, high_quality, excluded)
VALUES
  (900001, '00000000-5115-4000-8000-000000000001', 0, TRUE, FALSE),
  (900002, '00000000-5115-4000-8000-000000000002', 0, TRUE, FALSE),
  (900003, '00000000-5115-4000-8000-000000000003', 0, TRUE, FALSE),
  (900004, '00000000-5115-4000-8000-000000000004', 0, TRUE, FALSE)
ON CONFLICT (user_stat_id) DO NOTHING;

-- Panoramas, as prod recorded them. Expired with a backup on disk is the combination `imageryViewable` admits and
-- the one that makes LabelService.checkImageryBatch answer from the file system instead of a provider -- and a real
-- state a city reaches once imagery ages out and the backup job has run.
--
-- The unlabelled rows are the sweep specs' fixtures, with fixed past timestamps so they only get truer with time.
INSERT INTO sidewalk_teaneck.pano_data (pano_id, source, capture_date, width, height, tile_width, tile_height, lat, lng,
                                        camera_heading, camera_pitch, camera_roll, copyright,
                                        expired, expired_at, last_checked, has_backup)
VALUES
  ('60Fy6udfNJjDILZZ79n7Bg', 'gsv', '2022-01', 1024, 512, 512, 512,
   40.90675354003906, -73.99154663085938, 79.24706268310547, 2.0463600158691406, NULL, '© 2024 Google',
   TRUE, '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00', TRUE),
  ('HGiN2VdenH5bj760gRIvPw', 'gsv', '2022-01', 1024, 512, 512, 512,
   40.903831481933594, -73.99231719970703, 203.17477416992188, 0.7547799944877625, NULL, '© 2024 Google',
   TRUE, '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00', TRUE),
  ('gQIxyDH1bxP1In5JOau-mg', 'gsv', '2012-08', 1024, 512, 512, 512,
   40.906272888183594, -73.99870300292969, 280.24609375, -0.7641299962997437, NULL, '© 2024 Google',
   TRUE, '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00', TRUE),
  ('joksJLXQppwg9OlymTrkmQ', 'gsv', '2022-01', 1024, 512, 512, 512,
   40.906654357910156, -73.99195098876953, 166.69122314453125, 1.1992700099945068, NULL, '© 2024 Google',
   TRUE, '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00', TRUE),
  ('oi_myNRB0_p9VSsqsnmj-g', 'gsv', '2018-06', 1024, 512, 512, 512,
   40.90277862548828, -73.99308776855469, 114.71118927001953, 0.7602499723434448, NULL, '© 2023 Google',
   TRUE, '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00', TRUE),
  ('piBGpWaR_-QRyi6Yhjsmwg', 'gsv', '2022-01', 1024, 512, 512, 512,
   40.90630340576172, -73.99837493896484, 257.7508544921875, -0.7689800262451172, NULL, '© 2024 Google',
   TRUE, '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00', TRUE),
  -- Unexpired, and last checked well before the TTL cutoff: the one row the reuse rule must not answer for.
  ('3PGU6QVdqdLy-qy3vZ8hQw', 'gsv', '2022-01', 16384, 8192, 512, 512,
   40.90298080444336, -73.99298858642578, 206.9368896484375, 0.7709400057792664, NULL, '© 2023 Google',
   FALSE, NULL, '2020-01-01 00:00:00+00', FALSE),
  -- A LABELED Mapillary pano due for a check, so the nightly sweep's sampling query sees a non-gsv
  -- source. Real, from Richmond -- the one city on Mapillary imagery. Expired and unbacked, so it
  -- stays out of the Gallery; Validate and Explore already filter it out on the city's pano source.
  ('1050859256685844', 'mapillary', '2024-09', 11000, 5500, 11000, 5500,
   37.539015301397, -77.441233369283, 35.915695572831, 2.9712443964874025, 2.10982137066022, 'HKocen',
   TRUE, '2020-01-01 00:00:00+00', '2020-01-01 00:00:00+00', FALSE)
ON CONFLICT (pano_id) DO NOTHING;

-- Labeler 1 walks every street in the region because the outdated-imagery routing spec needs a user who has
-- finished one: it flags one of their audits and asserts the region re-opens, and there is nothing to re-open for a
-- user who never finished it. Completed and unflagged is what makes an audit count toward up-to-date coverage and
-- toward its user's audited distance.
INSERT INTO sidewalk_teaneck.mission (mission_id, mission_type, user_id, mission_start, mission_end, completed,
                                      pay, paid, distance_meters, distance_progress, region_id, skipped)
VALUES
  (900001, 'audit', '00000000-5115-4000-8000-000000000002', now() - INTERVAL '30 days', now() - INTERVAL '30 days',
   TRUE, 0.0, FALSE, 606.0, 606.0, 18, FALSE),
  (900002, 'audit', '00000000-5115-4000-8000-000000000003', now() - INTERVAL '20 days', now() - INTERVAL '20 days',
   TRUE, 0.0, FALSE, 310.7, 310.7, 18, FALSE)
ON CONFLICT (mission_id) DO NOTHING;
INSERT INTO sidewalk_teaneck.audit_task (audit_task_id, user_id, street_edge_id, task_start, task_end, completed,
                                         current_lat, current_lng, start_point_reversed, current_mission_id,
                                         low_quality, incomplete, stale, outdated_imagery)
VALUES
  (900001, '00000000-5115-4000-8000-000000000002', 479, now() - INTERVAL '26 days', now() - INTERVAL '26 days',
   TRUE, 40.9038259, -73.9922537, FALSE, 900001, FALSE, FALSE, FALSE, FALSE),
  (900002, '00000000-5115-4000-8000-000000000002', 842, now() - INTERVAL '26 days', now() - INTERVAL '26 days',
   TRUE, 40.9013, -73.991578, FALSE, 900001, FALSE, FALSE, FALSE, FALSE),
  (900003, '00000000-5115-4000-8000-000000000003', 1141, now() - INTERVAL '24 days', now() - INTERVAL '24 days',
   TRUE, 40.906837, -73.995232, FALSE, 900002, FALSE, FALSE, FALSE, FALSE),
  (900004, '00000000-5115-4000-8000-000000000002', 1334, now() - INTERVAL '26 days', now() - INTERVAL '26 days',
   TRUE, 40.90683, -73.991123, FALSE, 900001, FALSE, FALSE, FALSE, FALSE),
  -- Labeler 1 covering the one street in the region they did not label.
  (900005, '00000000-5115-4000-8000-000000000002', 1141, now() - INTERVAL '25 days', now() - INTERVAL '25 days',
   TRUE, 40.906837, -73.995232, FALSE, 900001, FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (audit_task_id) DO NOTHING;

-- A validation mission is ten labels of ONE type, chosen at random among the types with that many available, so
-- giving exactly one type enough makes the choice deterministic without pinning anything in application code. The
-- rest cover the forks the share, gallery and edit specs read. `correct` stays NULL, so all still need validating.
--
-- The two NoSidewalk labels have no crop, as prod has none for them either: still validatable (Validate reads the
-- backup panorama, not crops), just absent from the Gallery -- which is what that state means in production.
INSERT INTO sidewalk_teaneck.label (label_id, audit_task_id, mission_id, user_id, pano_id, label_type_id,
                                    street_edge_id, temporary_label_id, time_created, deleted, tutorial,
                                    severity, tags)
VALUES
  (900002, 900003, 900002, '00000000-5115-4000-8000-000000000003', 'gQIxyDH1bxP1In5JOau-mg', 1, 1141, 1,
   now() - INTERVAL '24 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 14861
  (900003, 900003, 900002, '00000000-5115-4000-8000-000000000003', 'gQIxyDH1bxP1In5JOau-mg', 1, 1141, 2,
   now() - INTERVAL '24 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 14863
  (900004, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 1,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15731
  (900005, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 2,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15732
  (900006, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 3,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15738
  (900007, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 4,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15739
  (900008, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 1, 479, 1,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15765
  (900009, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 1, 479, 2,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15767
  (900010, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 1, 479, 3,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15768
  (900011, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 1, 479, 4,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- CurbRamp, prod label 15769
  (900012, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 5,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- CurbRamp, prod label 21352
  (900013, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 6,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- CurbRamp, prod label 21353
  (900014, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 7,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- CurbRamp, prod label 21357
  (900015, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 1, 1334, 8,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- CurbRamp, prod label 21361
  (900016, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 1, 479, 5,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- CurbRamp, prod label 21439
  (900017, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 1, 479, 6,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- CurbRamp, prod label 21440
  (900018, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 1, 479, 7,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- CurbRamp, prod label 21441
  (900019, 900003, 900002, '00000000-5115-4000-8000-000000000003', 'gQIxyDH1bxP1In5JOau-mg', 9, 1141, 3,
   now() - INTERVAL '24 days', FALSE, FALSE, 1, '{}'),  -- Crosswalk, prod label 14862
  (900020, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 9, 1334, 9,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- Crosswalk, prod label 15733
  (900021, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 9, 479, 8,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- Crosswalk, prod label 15766
  (900022, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 9, 479, 9,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- Crosswalk, prod label 15770
  (900023, 900004, 900001, '00000000-5115-4000-8000-000000000002', 'joksJLXQppwg9OlymTrkmQ', 9, 1334, 10,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- Crosswalk, prod label 21781
  (900024, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'HGiN2VdenH5bj760gRIvPw', 9, 479, 10,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{}'),  -- Crosswalk, prod label 22518
  (900025, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'oi_myNRB0_p9VSsqsnmj-g', 2, 479, 11,
   now() - INTERVAL '26 days', FALSE, FALSE, 2, '{"no alternate route"}'),  -- NoCurbRamp, prod label 4793
  (900026, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'oi_myNRB0_p9VSsqsnmj-g', 2, 479, 12,
   now() - INTERVAL '26 days', FALSE, FALSE, 2, '{"no alternate route"}'),  -- NoCurbRamp, prod label 4797
  (900027, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'oi_myNRB0_p9VSsqsnmj-g', 7, 479, 13,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- NoSidewalk, prod label 796
  (900028, 900001, 900001, '00000000-5115-4000-8000-000000000002', 'oi_myNRB0_p9VSsqsnmj-g', 7, 479, 14,
   now() - INTERVAL '26 days', FALSE, FALSE, NULL, '{}'),  -- NoSidewalk, prod label 797
  (900029, 900003, 900002, '00000000-5115-4000-8000-000000000003', 'piBGpWaR_-QRyi6Yhjsmwg', 3, 1141, 4,
   now() - INTERVAL '24 days', FALSE, FALSE, 2, '{"parked car"}'),  -- Obstacle, prod label 14864
  (900030, 900003, 900002, '00000000-5115-4000-8000-000000000003', 'piBGpWaR_-QRyi6Yhjsmwg', 3, 1141, 5,
   now() - INTERVAL '24 days', FALSE, FALSE, 2, '{"parked car"}'),  -- Obstacle, prod label 24726
  (900031, 900003, 900002, '00000000-5115-4000-8000-000000000003', 'piBGpWaR_-QRyi6Yhjsmwg', 3, 1141, 6,
   now() - INTERVAL '24 days', FALSE, FALSE, 2, '{"parked car"}'),  -- Obstacle, prod label 24727
  -- The Mapillary pano's label. Neither the newest nor the oldest on purpose: the share and story
  -- specs read the HIGHEST label id and need a pano carrying GSV metadata, and phone-viewport reads
  -- the LOWEST near the city centre and needs imagery that resolves. This one has neither a crop nor
  -- a backup, which is exactly the case those two must not land on.
  (900032, 900003, 900002, '00000000-5115-4000-8000-000000000003', '1050859256685844', 4, 1141, 99,
   now() - INTERVAL '14 days', FALSE, FALSE, 1, '{}'),  -- SurfaceProblem, Richmond label 25062
  (900033, 900004, 900001, '00000000-5115-4000-8000-000000000002', '60Fy6udfNJjDILZZ79n7Bg', 4, 1334, 11,
   now() - INTERVAL '26 days', FALSE, FALSE, 1, '{"bumpy"}'),  -- SurfaceProblem, prod label 21798
  (900034, 900003, 900002, '00000000-5115-4000-8000-000000000003', 'gQIxyDH1bxP1In5JOau-mg', 4, 1141, 7,
   now() - INTERVAL '24 days', FALSE, FALSE, 1, '{"utility panel"}')  -- SurfaceProblem, prod label 24725
ON CONFLICT (label_id) DO NOTHING;

-- Validate, the LabelMap, the clustering queries and the metadata serializer all join label_point, so a label
-- without one is invisible to every one of them.
INSERT INTO sidewalk_teaneck.label_point (label_point_id, label_id, pano_x, pano_y, canvas_x, canvas_y,
                                          heading, pitch, zoom, lat, lng, geom, computation_method)
SELECT p.* FROM (VALUES
  (900002, 900002, 838, 373, 164, 333,
   73.25, -33.6875, 1, 40.90629255696513, -73.99868476842572,
   ST_SetSRID(ST_MakePoint(-73.99868476842572, 40.90629255696513), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900003, 900003, 200, 305, 497, 131,
   149.75, -35, 1, 40.90620532775984, -73.99868822461255,
   ST_SetSRID(ST_MakePoint(-73.99868822461255, 40.90620532775984), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900004, 900004, 364, 325, 193, 348,
   141, -10, 1, 40.906634803286764, -73.99189463208181,
   ST_SetSRID(ST_MakePoint(-73.99189463208181, 40.906634803286764), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900005, 900005, 300, 322, 189, 342,
   119, -10, 1, 40.90665249572615, -73.99188632022113,
   ST_SetSRID(ST_MakePoint(-73.99188632022113, 40.90665249572615), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900006, 900006, 71, 289, 548, 183,
   343.8125, -22, 1, 40.9067550143793, -73.99192363034562,
   ST_SetSRID(ST_MakePoint(-73.99192363034562, 40.9067550143793), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900007, 900007, 104, 290, 648, 199,
   343.8125, -22, 1, 40.90674440089164, -73.99189990134902,
   ST_SetSRID(ST_MakePoint(-73.99189990134902, 40.90674440089164), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900008, 900008, 599, 316, 643, 285,
   210.8907870718873, -19.143790218355697, 2, 40.90379926221117, -73.99237559614758,
   ST_SetSRID(ST_MakePoint(-73.99237559614758, 40.90379926221117), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900009, 900009, 424, 315, 196, 230,
   185.80436198213147, -22.089231993276798, 2, 40.90377641200025, -73.99230709630278,
   ST_SetSRID(ST_MakePoint(-73.99230709630278, 40.90377641200025), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900010, 900010, 390, 308, 263, 189,
   168.4017791748047, -22.625, 2, 40.90377191934317, -73.99228906064927,
   ST_SetSRID(ST_MakePoint(-73.99228906064927, 40.90377191934317), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900011, 900011, 365, 289, 143, 106,
   168.4017791748047, -22.625, 2, 40.90374128121807, -73.99225262537192,
   ST_SetSRID(ST_MakePoint(-73.99225262537192, 40.90374128121807), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900012, 900012, 306, 325, 176, 271,
   123.87872202717949, -22.35063473584438, 1, 40.9066509264618, -73.99188888694293,
   ST_SetSRID(ST_MakePoint(-73.99188888694293, 40.9066509264618), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900013, 900013, 365, 324, 309, 252,
   123.86793292164049, -22.36793949645495, 1, 40.90663432930094, -73.9918943579489,
   ST_SetSRID(ST_MakePoint(-73.9918943579489, 40.90663432930094), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900014, 900014, 70, 287, 346, 291,
   13.625, -3, 1, 40.906760204639575, -73.99192277894302,
   ST_SetSRID(ST_MakePoint(-73.99192277894302, 40.906760204639575), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900015, 900015, 101, 290, 415, 297,
   13.621088427242512, -2.9973305956131133, 1, 40.90674739718381, -73.99190036734737,
   ST_SetSRID(ST_MakePoint(-73.99190036734737, 40.90674739718381), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900016, 900016, 602, 312, 481, 209,
   214.99562608394103, -25.81795701815716, 1, 40.903797632029494, -73.99238031243651,
   ST_SetSRID(ST_MakePoint(-73.99238031243651, 40.903797632029494), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900017, 900017, 422, 315, 254, 237,
   189.1205142835763, -22.064408309903165, 1, 40.90377628674277, -73.99230644459702,
   ST_SetSRID(ST_MakePoint(-73.99230644459702, 40.90377628674277), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900018, 900018, 396, 309, 191, 232,
   189.12779776380467, -22.06519108225775, 1, 40.903772353540866, -73.99229263731901,
   ST_SetSRID(ST_MakePoint(-73.99229263731901, 40.903772353540866), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900019, 900019, 143, 380, 532, 346,
   115.38906570431902, -33.11298023600823, 1, 40.9062537376643, -73.99868864681376,
   ST_SetSRID(ST_MakePoint(-73.99868864681376, 40.9062537376643), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900020, 900020, 180, 318, 202, 329,
   75, -10, 1, 40.906688036627834, -73.99189764383632,
   ST_SetSRID(ST_MakePoint(-73.99189764383632, 40.906688036627834), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900021, 900021, 509, 329, 258, 325,
   210.8942782023811, -19.153277326322414, 2, 40.903790742363526, -73.99233901271069,
   ST_SetSRID(ST_MakePoint(-73.99233901271069, 40.903790742363526), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900022, 900022, 387, 299, 248, 148,
   168.4017791748047, -22.625, 2, 40.9037588857308, -73.99228098045577,
   ST_SetSRID(ST_MakePoint(-73.99228098045577, 40.9037588857308), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900023, 900023, 184, 311, 306, 150,
   60.0625, -33.5, 1, 40.90669191009617, -73.9918889409885,
   ST_SetSRID(ST_MakePoint(-73.9918889409885, 40.90669191009617), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900024, 900024, 499, 332, 264, 292,
   215, -19.625, 1, 40.90379199154322, -73.99233463198286,
   ST_SetSRID(ST_MakePoint(-73.99233463198286, 40.90379199154322), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900025, 900025, 149, 294, 209, 246,
   359.34820556640625, -13.214285850524902, 2, 40.90286480337585, -73.99311357299085,
   ST_SetSRID(ST_MakePoint(-73.99311357299085, 40.90286480337585), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900026, 900026, 348, 295, 366, 267,
   56.66964340209961, -11.517857551574707, 2, 40.902825519888374, -73.99299146226697,
   ST_SetSRID(ST_MakePoint(-73.99299146226697, 40.902825519888374), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900027, 900027, 140, 292, 415, 152,
   335.42449048835226, -26.385876156124088, 1, 40.902869425121864, -73.99312212607911,
   ST_SetSRID(ST_MakePoint(-73.99312212607911, 40.902869425121864), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900028, 900028, 370, 290, 406, 103,
   57.93764520129656, -32.94524944717089, 1, 40.90282029820424, -73.99297018811754,
   ST_SetSRID(ST_MakePoint(-73.99297018811754, 40.90282029820424), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900029, 900029, 135, 290, 625, 106,
   89.75, -35, 1, 40.906246582922456, -73.9982681446798,
   ST_SetSRID(ST_MakePoint(-73.9982681446798, 40.906246582922456), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900030, 900030, 145, 294, 414, 163,
   124.46428680419922, -19.64285659790039, 2, 40.906248463319685, -73.99828464362717,
   ST_SetSRID(ST_MakePoint(-73.99828464362717, 40.906248463319685), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900031, 900031, 945, 281, 280, 143,
   53.05803680419922, -12.470982551574707, 3, 40.90638773008082, -73.99824249138564,
   ST_SetSRID(ST_MakePoint(-73.99824249138564, 40.90638773008082), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900032, 900032, 6777, 3087, 361, 214,
   77.62438046349416, -13.091208100797724, 2, 40.90629255696513, -73.99868476842572,
   ST_SetSRID(ST_MakePoint(-73.99868476842572, 40.90629255696513), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900033, 900033, 681, 314, 244, 178,
   157.375, -31.125, 1, 40.906710939631004, -73.99149696724463,
   ST_SetSRID(ST_MakePoint(-73.99149696724463, 40.906710939631004), 4326),
   'depth'::sidewalk_teaneck.computation_method),
  (900034, 900034, 820, 353, 367, 350,
   27.714284896850586, -25.35714340209961, 2, 40.906300334741914, -73.99868339581884,
   ST_SetSRID(ST_MakePoint(-73.99868339581884, 40.906300334741914), 4326),
   'depth'::sidewalk_teaneck.computation_method)
) AS p(label_point_id, label_id, pano_x, pano_y, canvas_x, canvas_y,
        heading, pitch, zoom, lat, lng, geom, computation_method)
WHERE NOT EXISTS (SELECT 1 FROM sidewalk_teaneck.label_point WHERE label_id = p.label_id);

-- One label carries a full validation -- the vote, its effect on the label's counts, and the comment beside it --
-- because the share page takes a different branch for a label with no validator comments.
INSERT INTO sidewalk_teaneck.mission (mission_id, mission_type, user_id, mission_start, mission_end, completed,
                                      pay, paid, region_id, labels_validated, labels_progress, label_type_id, skipped)
VALUES (900004, 'validation', '00000000-5115-4000-8000-000000000002',
        now() - INTERVAL '5 days', now() - INTERVAL '5 days',
        TRUE, 0.0, FALSE, 18, 1, 1, 1, FALSE)
ON CONFLICT (mission_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.label_validation (label_validation_id, label_id, validation_result, user_id, mission_id,
                                               canvas_x, canvas_y, heading, pitch, zoom, canvas_height, canvas_width,
                                               start_timestamp, end_timestamp, source, viewer_type)
VALUES (900001, 900002, 'Agree', '00000000-5115-4000-8000-000000000002', 900004, 300, 200, 120.0, -10.0, 1.0,
        480, 720, now() - INTERVAL '5 days', now() - INTERVAL '5 days', 'Validate', 'Default')
ON CONFLICT (label_validation_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.validation_task_comment (validation_task_comment_id, mission_id, label_id, user_id,
                                                      ip_address, pano_id, heading, pitch, zoom, lat, lng,
                                                      timestamp, comment)
VALUES (900001, 900004, 900002, '00000000-5115-4000-8000-000000000002', '127.0.0.1', 'gQIxyDH1bxP1In5JOau-mg',
        120.0, -10.0, 1.0, 40.90629255696513, -73.99868476842572, now() - INTERVAL '5 days',
        'Agreed, the ramp is there and usable.')
ON CONFLICT (validation_task_comment_id) DO NOTHING;

-- What a real Agree leaves behind on the label itself.
UPDATE sidewalk_teaneck.label SET agree_count = 1, correct = TRUE
WHERE label_id = 900002 AND agree_count = 0;

-- A route over the region's streets. distance_meters is computed the way RouteTable.updateStats does, because
-- GeodesicDistanceSpec re-runs that recompute and demands the cached value already match.
INSERT INTO sidewalk_teaneck.route (route_id, user_id, region_id, name, public, deleted, created_at, slug,
                                    description, distance_meters, street_count)
VALUES (900001, '00000000-5115-4000-8000-000000000002', 18, 'CI seed route', TRUE, FALSE,
        now() - INTERVAL '15 days', 'ci-seed-route', 'Every street in the seeded region, in order.', 0, 0)
ON CONFLICT (route_id) DO NOTHING;

INSERT INTO sidewalk_teaneck.route_street (route_street_id, route_id, street_edge_id, reverse, position)
VALUES
  (900001, 900001, 479, FALSE, 0),
  (900002, 900001, 842, FALSE, 1),
  (900003, 900001, 1141, FALSE, 2),
  (900004, 900001, 1334, FALSE, 3)
ON CONFLICT (route_street_id) DO NOTHING;

UPDATE sidewalk_teaneck.route
SET distance_meters = COALESCE(stats.distance_meters, 0), street_count = COALESCE(stats.street_count, 0)
FROM (
  SELECT SUM(ST_Length(street_edge.geom::geography)) AS distance_meters, COUNT(*) AS street_count
  FROM sidewalk_teaneck.route_street
  INNER JOIN sidewalk_teaneck.street_edge USING (street_edge_id)
  WHERE route_street.route_id = 900001
) AS stats
WHERE route.route_id = 900001;

-- Derived caches, last because each reads the rows above. Keep in step with:
--   meters_audited / labels_per_meter / high_quality -> UserStatTable.updateAuditedDistanceHelper,
--                                                       updateLabelsPerMeterHelper, updateHighQuality
--   region_completion                                -> RegionService.initializeRegionCompletionTableAction
-- "Auditable streets" in all of them means open, non-tutorial streets -- StreetEdgeTable's `streets`.
UPDATE sidewalk_teaneck.user_stat
SET meters_audited = COALESCE((
      SELECT SUM(ST_Length(street_edge.geom::geography))
      FROM sidewalk_teaneck.audit_task
      INNER JOIN sidewalk_teaneck.street_edge USING (street_edge_id)
      WHERE audit_task.completed
        AND audit_task.user_id = user_stat.user_id
        AND street_edge.status = 'open'
        AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
    ), 0)
WHERE user_stat.user_id LIKE '00000000-5115-%';

-- Counted the way `labelsWithExcludedUsers` counts: every label under one of the user's `audit` missions (not
-- auditOnboarding), minus deleted and tutorial labels and anything on the tutorial street. No seeded label is
-- deleted or tutorial today, so those two predicates change nothing yet -- they are here because the moment one is
-- added, this cache has to move with it or GeodesicDistanceSpec fails pointing at the recompute rather than here.
UPDATE sidewalk_teaneck.user_stat
SET labels_per_meter = CASE
      WHEN meters_audited > 0 THEN (
        SELECT COUNT(*)
        FROM sidewalk_teaneck.label
        INNER JOIN sidewalk_teaneck.mission USING (mission_id)
        INNER JOIN sidewalk_teaneck.audit_task ON audit_task.audit_task_id = label.audit_task_id
        WHERE mission.mission_type = 'audit'
          AND mission.user_id = user_stat.user_id
          AND NOT label.deleted
          AND NOT label.tutorial
          AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
          AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
      )::double precision / meters_audited
      ELSE NULL
    END
WHERE user_stat.user_id LIKE '00000000-5115-%';

-- What the seeded validation leaves on its author's stats, computed the way UserStatTable.updateAccuracy computes
-- it: over the user's own non-deleted, non-tutorial labels, counting the ones a validator has judged. Users with no
-- labels keep the 0/NULL defaults, which is what the runtime's INNER JOIN leaves them at.
UPDATE sidewalk_teaneck.user_stat
SET own_labels_validated = accuracy_subquery.validated_count, accuracy = accuracy_subquery.accuracy
FROM (
  SELECT label.user_id,
         COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS validated_count,
         CAST(SUM(CASE WHEN correct THEN 1 ELSE 0 END) AS FLOAT)
           / NULLIF(SUM(CASE WHEN correct THEN 1 ELSE 0 END) + SUM(CASE WHEN NOT correct THEN 1 ELSE 0 END), 0)
           AS accuracy
  FROM sidewalk_teaneck.label
  WHERE NOT label.deleted AND NOT label.tutorial
  GROUP BY label.user_id
) AS accuracy_subquery
WHERE user_stat.user_id = accuracy_subquery.user_id
  AND user_stat.user_id LIKE '00000000-5115-%';

-- The quality heuristic, minus only the branches these rows can't reach (none is excluded or manually rated). The
-- two seeded labelers land either side of the 0.0375 labeling-frequency threshold, which exercises the recompute in
-- both directions; the accuracy clause is written out rather than assumed away, so seeding more validations later
-- can't silently diverge from updateHighQuality.
UPDATE sidewalk_teaneck.user_stat
SET high_quality = (meters_audited = 0 OR COALESCE(labels_per_meter, 5) > 0.0375)
                   AND (COALESCE(accuracy, 1.0) > 0.6 OR own_labels_validated < 50)
WHERE user_stat.user_id LIKE '00000000-5115-%';

-- One row per non-deleted region, zeroes included -- and, like the recompute, a street counts only when it is
-- auditable AND carries a priority row, which is also what decides whether it counts as audited.
INSERT INTO sidewalk_teaneck.region_completion (region_id, total_distance, audited_distance)
SELECT region.region_id, COALESCE(distances.total, 0), COALESCE(distances.audited, 0)
FROM sidewalk_teaneck.region
LEFT JOIN (
  SELECT street_edge_region.region_id,
         SUM(ST_Length(street_edge.geom::geography)) AS total,
         SUM(CASE WHEN street_edge_priority.priority < 1.0
                  THEN ST_Length(street_edge.geom::geography) ELSE 0 END) AS audited
  FROM sidewalk_teaneck.street_edge_region
  INNER JOIN sidewalk_teaneck.street_edge USING (street_edge_id)
  INNER JOIN sidewalk_teaneck.street_edge_priority USING (street_edge_id)
  WHERE street_edge.status = 'open'
    AND street_edge.street_edge_id <> (SELECT tutorial_street_edge_id FROM sidewalk_teaneck.config)
  GROUP BY street_edge_region.region_id
) AS distances ON distances.region_id = region.region_id
WHERE region.deleted = FALSE
ON CONFLICT (region_id) DO NOTHING;

-- Teaneck's own map parameters. The committed template ships someone else's centre and bounding box, which puts
-- every map hundreds of miles from the only labels there are, so anything reading the centre to decide what to show
-- sees nothing until the two agree. The tutorial street id is deliberately NOT taken from prod -- the tutorial here
-- is the template's own, whose panorama tiles are local assets.
UPDATE sidewalk_teaneck.config
SET city_center_lat = 40.888, city_center_lng = -74.015,
    southwest_boundary_lat = 40.4,
    southwest_boundary_lng = -74.5,
    northeast_boundary_lat = 41.4,
    northeast_boundary_lng = -73.5,
    default_map_zoom = 12.75
WHERE city_center_lat <> 40.888;

-- Tag 86 is real data every city but Zurich hides (evolution 298), and the only tag whose name contains a comma --
-- which is the whole point of the Gallery filter case that reads one back out of a URL. Un-hiding it beats
-- inventing a tag that doesn't exist.
UPDATE sidewalk_teaneck.config
SET excluded_tags = (
  SELECT COALESCE(JSONB_AGG(elem), '[]'::jsonb)
  FROM JSONB_ARRAY_ELEMENTS(excluded_tags) AS elem
  WHERE elem <> '{"label_type": "Signal", "tag": "yellow box, accessibility features not visible"}'::jsonb
);
