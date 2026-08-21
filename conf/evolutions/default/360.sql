# --- !Ups
-- #4587/#4773, part 1: give the two locally-served tutorial panos real pano_data rows under a `tutorial` source.
--
-- #4773 kept these synthetic panos out of pano_data entirely, which makes the FK label.pano_id -> pano_data.pano_id
-- unreachable: 8,803 of the 8,910 prod labels with no pano_data row are tutorial labels, regenerated on every
-- tutorial run. The leak it was closing -- a synthetic pano reaching /adminapi/panos and being handed to the scraper
-- as real imagery -- is a filtering problem, and `source` filters it in a way a mistyped id literal cannot defeat.
-- PanoSource.providerCheckedSources already gates every provider-facing path, so the new value also stops
-- CheckImageExpiryActor asking Google about an id that cannot exist. It has been asking: 19 of the 20 existing
-- 'tutorial' rows are marked expired from its ZERO_RESULTS answers.
--
-- Values are GsvViewer.#getCustomPanoData's, which is what the viewer serves and what the client computes each
-- label's pano_x/pano_y against. The client negates originPitch, so -1.13769 is stored as 1.13769.
--
-- Not fixed, deliberately: tutorial labels from before ~2023-05 hold pano_x/pano_y on a 13312x6656 grid, because
-- evolution 179 converted them against the row this replaces, so they disagree with it by 3.25x in width. Nothing
-- reads tutorial label positions, so the ~98k rows are left alone (#4587 discussion, 2026-08-20).

-- Rebuild rather than ALTER TYPE ... ADD VALUE: evolutions share one transaction, so a value added here could not
-- be used by the upsert below -- "unsafe use of new value". A type created in the same transaction carries no such
-- restriction (342.sql/352.sql mechanics). pano_data.source is the type's only column anywhere.
ALTER TABLE pano_data ALTER COLUMN source TYPE TEXT USING source::text;
DROP TYPE pano_source;
CREATE TYPE pano_source AS ENUM ('gsv', 'mapillary', 'infra3d', 'tutorial');

-- Insert where absent (34 cities lack the 'tutorial' row, 1 lacks 'afterWalkTutorial'), correct where present --
-- every existing row predates the current tutorial imagery. Only the imagery columns are overwritten: last_viewed,
-- has_backup, pano_history_saved and source_metadata record real usage and on-disk state.
INSERT INTO pano_data (pano_id, width, height, tile_width, tile_height, capture_date, copyright, expired, lat, lng,
                       camera_heading, camera_pitch, source)
VALUES ('tutorial', 4096, 2048, 2048, 1024, '2014-05', 'Imagery (c) 2010 Google', FALSE,
        38.94042608, -77.06766133, 50.3866, 1.13769, 'tutorial'),
       ('afterWalkTutorial', 3400, 1700, 1700, 850, '2014-05', 'Imagery (c) 2010 Google', FALSE,
        38.94061618, -77.06768201, 344, 0, 'tutorial')
ON CONFLICT (pano_id) DO UPDATE
SET width          = EXCLUDED.width,
    height         = EXCLUDED.height,
    tile_width     = EXCLUDED.tile_width,
    tile_height    = EXCLUDED.tile_height,
    capture_date   = EXCLUDED.capture_date,
    copyright      = EXCLUDED.copyright,
    expired        = EXCLUDED.expired,
    lat            = EXCLUDED.lat,
    lng            = EXCLUDED.lng,
    camera_heading = EXCLUDED.camera_heading,
    camera_pitch   = EXCLUDED.camera_pitch,
    source         = EXCLUDED.source;

ALTER TABLE pano_data ALTER COLUMN source TYPE pano_source USING source::pano_source;

-- 181 labels across 14 cities sit on a synthetic pano with tutorial = FALSE, from two causes, both since fixed: 89
-- (2023-2026) were placed while auditing the DC tutorial street, which #4179 stopped serving, and 92 (2019-2020) are
-- the opening labels of a first audit mission, saved before the viewer's pano id caught up. `tutorial` is what every
-- consumer filters on and these are not real-world observations, deleted ones included. Their users' user_stat
-- counts are computed with tutorial = FALSE and want a recompute on rollout, which the nightly refresh also does.
UPDATE label SET tutorial = TRUE WHERE pano_id IN ('tutorial', 'afterWalkTutorial') AND NOT tutorial;


-- PART 2 (#4587): restore pano_data for all 98 panos whose metadata write was lost, covering 157 labels.
--
-- Until v11.8.1 (#4869) the pano metadata write was fire-and-forget, so a label could be committed while its
-- pano_data row was silently dropped. Values come from four sources, in precedence order (derivation and the
-- cross-source validation are in scratchpad/4587-generate-backfill-values.py and the plan doc):
--
--   1. old_label_metadata, which evolution 179 filled from label.photographer_heading/photographer_pitch and
--      label.panorama_lat/lng as it moved those per-label copies onto the pano table. They describe the imagery the
--      labeller actually saw, so they win outright: on 5 of the 45 panos below, the scrape in (3) had caught
--      different imagery, off by up to 8.9 deg and 14.6 m. Covers 61 of the 98 -- every label predating v7.12.2.
--   2. Google's photometa endpoint, for the 49 panos still served (the legacy cbk endpoint now 404s).
--   3. cbk XML sidecars in the pano image store, for the 45 scraped before 2022-03-14 (aac479231), while the
--      scraper's work list still came from the label table rather than pano_data.
--   4. A surviving pano of the same drive, for dimensions of the 25 Google has deleted.
--
-- 17 rows carry no camera angles or position, deliberately: those are the fields evolution 179's conversion keys
-- on, so an absent value keeps the row out of every position recompute, where a plausible guess would be trusted
-- and would move labels that are currently right. Dimensions are safe to infer for that same reason.
--
-- 25 rows hold an estimated capture_date, flagged in source_metadata with the pano it was read from: the newest
-- capture Google still serves near the pano on or before its last label, since the deleted pano was current then.
-- A real capture date at that location, though not provably the deleted pano's own.
--
-- expired and last_checked record the 2026-08-21 sweep, which got a definitive answer for all 97 GSV panos.
-- has_backup is TRUE for the 45 with a stored image, so a label on deleted imagery still renders.
--
-- Pano ids are global, so the join against label is what keeps each schema to its own panos.
INSERT INTO pano_data (pano_id, width, height, tile_width, tile_height, lat, lng, camera_heading, camera_pitch,
                       capture_date, address, source, expired, has_backup, last_viewed, last_checked, source_metadata)
SELECT recovered.pano_id, recovered.width, recovered.height, recovered.tile_width, recovered.tile_height,
       recovered.lat, recovered.lng, recovered.camera_heading, recovered.camera_pitch, recovered.capture_date,
       recovered.address, recovered.source::pano_source, recovered.expired, recovered.has_backup,
       seen.last_labeled, '2026-08-21',
       CASE WHEN recovered.date_source_pano IS NOT NULL THEN jsonb_build_object(
         'capture_date_estimated', TRUE,
         'capture_date_basis', 'newest capture Google still serves within 60 m on or before the pano''s last label',
         'capture_date_source_pano', recovered.date_source_pano,
         'issue', 4587) END
FROM (VALUES
    -- amsterdam
    ('IU6xDOn1LzV6WnYPg7R4uw', 16384, 8192, 512, 512, 52.35328674316406, 5.005771636962891, 224.65484619140625, 0.207550048828125, '2021-03', NULL, 'gsv', TRUE, FALSE, 'r9MZqH8CYo0vtjlxIalcEQ'),
    ('UPxzd1SPIA5o4udTq_qp3A', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2024-05', NULL, 'gsv', TRUE, FALSE, '8piL7x14sFRGRYAANtlRkQ'),
    ('ZnN1k5cb8jn8x-DT4p51wQ', 16384, 8192, 512, 512, 52.399879455566406, 4.943231105804443, 283.2419738769531, -0.1750030517578125, '2020-08', 'IJdoornlaan', 'gsv', FALSE, TRUE, NULL),
    ('_bo4xBh2TEw5odDce9nAvQ', 16384, 8192, 512, 512, 52.354190826416016, 5.001533031463623, 221.59129333496094, 0.8134384155273438, '2021-08', NULL, 'gsv', TRUE, FALSE, 'mk6mAkxwnchInRGjNDsEXw'),
    -- cdmx
    ('CJ-QFkxbDhjftegCSpcSFw', 16384, 8192, 512, 512, 19.481462478637695, -99.17459869384766, 4.201688289642334, -1.0549774169921875, '2019-09', '395 Eje 4 Pte', 'gsv', FALSE, TRUE, NULL),
    ('SQEvsqD7xBEbvBS8lBZhog', 16384, 8192, 512, 512, 19.47725467101163, -99.19999134820006, 197.0057373046875, -0.42034, '2025-01', '106 Av Tezozomoc, Mexico City', 'gsv', FALSE, FALSE, NULL),
    ('V2eMH3rj_m8FaMQvAh-qkg', 16384, 8192, 512, 512, 19.50800475512558, -99.2015419578887, 269.6044006347656, -0.50243, '2022-06', '173 Aztecas, Mexico City', 'gsv', FALSE, FALSE, NULL),
    ('k3xWZof11YvVJ3cpOaPotA', 16384, 8192, 512, 512, 19.485830307006836, -99.1902847290039, 43.75224304199219, 0.9129867553710938, '2019-04', '394 Rey Maxtla', 'gsv', FALSE, TRUE, NULL),
    ('rFnokTwtWlFqZJb0xWtRrQ', 16384, 8192, 512, 512, 19.50587508303683, -99.21160744919084, 187.0027923583984, 0.56986, '2025-01', '114 Calz. de Las Armas, Tlalnepantla de Baz, State of Mexico', 'gsv', FALSE, FALSE, NULL),
    ('uZ1jHx62NoDiEM3VBAAy6g', 16384, 8192, 512, 512, 19.501237869262695, -99.19574737548828, 285.5877685546875, -0.31623077392578125, '2019-07', '303 Calz. de los Angeles', 'gsv', FALSE, TRUE, NULL),
    ('x9n7BzN6G-8DytRqgszuzg', 16384, 8192, 512, 512, 19.47666358947754, -99.1603012084961, 10.874388694763184, -0.18536376953125, '2019-03', '25 Guam', 'gsv', FALSE, TRUE, NULL),
    -- chicago
    ('99AnoYWD5cp5H3lP1bmK7Q', 16384, 8192, 512, 512, 41.628231048583984, -87.64019775390625, 178.82449340820312, -0.7953500151634216, '2022-07', '14359 Union Ave, Harvey, Illinois', 'gsv', FALSE, FALSE, NULL),
    ('AP7knM-He3aCfhM07x4F8A', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2024-07', NULL, 'gsv', TRUE, FALSE, 'BBy7_DRNFhczLRn6qom9lA'),
    ('N-sqXHmUyEIEh7eQ7iLclA', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-08', NULL, 'gsv', TRUE, FALSE, 'fFG-Zq92Kfs5Ymm3U2MtKQ'),
    ('N6wBj0m4ssrd5SNy8Q8TIw', 16384, 8192, 512, 512, 41.7992403888875, -87.78568237551303, 178.7153625488281, -0.88094, '2019-09', '5111 S Neenah Ave, Chicago, Illinois', 'gsv', FALSE, FALSE, NULL),
    ('vxb4UcwquGq2lxLfUO3pkA', 16384, 8192, 512, 512, 41.87661203393171, -87.75768600126688, 89.32597351074219, 0.31559, '2024-05', '5301 W Jackson Blvd, Chicago, Illinois', 'gsv', FALSE, FALSE, NULL),
    ('w2UeYrc0gXBzu-JAklOFyA', 16384, 8192, 512, 512, 41.92860433162534, -87.6878654458535, 178.6281890869141, 0.38739, '2022-09', '2600 N Western Ave, Chicago, Illinois', 'gsv', FALSE, FALSE, NULL),
    -- columbus
    ('C2If792tPUzWMGyr6r82Ig', 16384, 8192, 512, 512, 39.97142791748047, -83.00952911376953, 183.3622283935547, -0.5271072387695312, '2019-07', '463 Neil Ave', 'gsv', TRUE, TRUE, NULL),
    ('tWmYM9hAKJ0EJ7rZv-IDKQ', 16384, 8192, 512, 512, 40.02085876464844, -82.98590087890625, 273.031494140625, -0.0796966552734375, '2019-07', NULL, 'gsv', TRUE, FALSE, 'tgPwsO3zt5Aas5pdU0I0ag'),
    -- cuenca
    ('E_88NCDwjxY5DsGxBMyJ_g', 13312, 6656, 512, 512, -2.915157047115295, -79.00890240576565, 297.23486328125, -1.26974, '2015-03', 'Ave 27 de Febrero, Cuenca, Azuay', 'gsv', FALSE, FALSE, NULL),
    -- kaohsiung
    ('DrUDuDms60T5w1GkuuUGLA', 16384, 8192, 512, 512, 22.6228665576659, 120.3626638953878, 133.2219543457031, -0.11493, '2024-04', '21 Guangming Rd, Kaohsiung, Kaohsiung City', 'gsv', FALSE, FALSE, NULL),
    ('Jv2v3MvzOAwigHwVnlUkWQ', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2026-01', NULL, 'gsv', TRUE, FALSE, '0DcIS84xqMgZPNo1geDiQg'),
    ('YqBHER_txEVysk6JiOMj0A', 16384, 8192, 512, 512, 22.52277815292013, 120.3628686637031, 190.4314422607422, 0.771, '2024-06', '8 Zhongli St, Kaohsiung City', 'gsv', FALSE, FALSE, NULL),
    ('_yK0yAc9IDoRc9FwLRMyNg', 16384, 8192, 512, 512, 22.57118473011544, 120.3553498134667, 111.0339584350586, 0.95531, '2024-08', '55 Changheng Rd, Kaohsiung, Kaohsiung City', 'gsv', FALSE, FALSE, NULL),
    -- newberg
    ('fnb5GJbzBKNYkTbiJsCTJw', 13312, 6656, 512, 512, 45.33045196533203, -122.97178649902344, 230.1892852783203, 3.531768798828125, '2018-09', '25935 NE North Valley Rd', 'gsv', FALSE, TRUE, NULL),
    -- niagara_falls
    ('13Ry-9C6VcZfJZDvYZ8Akg', 16384, 8192, 512, 512, 43.1235346403348, -79.0531935625462, 272.5938415527344, -0.41271, '2020-10', '900 Vanderbilt Ave, Niagara Falls, New York', 'gsv', FALSE, FALSE, NULL),
    ('zFozhKJOeXovqj_lQAhWpg', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-08', NULL, 'gsv', TRUE, FALSE, 'dIO8tnf1YsRgVOv8Mc36IQ'),
    -- oradell
    ('1CyCSX-ZcgaOSbf71Hc2XQ', 13312, 6656, 512, 512, 40.94126510620117, -74.02828979492188, 195.6960906982422, 0.7701034545898438, '2012-08', '16 Windsor Rd, Oradell, New Jersey', 'gsv', FALSE, FALSE, NULL),
    ('ZDivi4KZ-NZoXklA1_gznA', 13312, 6656, 512, 512, 40.95710045998538, -74.01913655452212, 14.10795593261719, 0.2557, '2012-08', 'Lake Shore Dr, Haworth, New Jersey', 'gsv', FALSE, FALSE, NULL),
    ('ua5L1w72YO7EfGkCzsImAQ', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2023-07', NULL, 'gsv', TRUE, FALSE, '46ZX4c88ZfjWwZsLxokP4Q'),
    -- paterson
    ('rVjnY_Xz7gHyJsKd7xpZ0A', 16384, 8192, 512, 512, 40.93573149972829, -74.15714804578569, 13.80425262451172, 0.80003, '2020-11', '35 E 11th St, Paterson, New Jersey', 'gsv', FALSE, FALSE, NULL),
    -- pittsburgh
    ('HUyAJCgNt4BiU8Y9YuTgUw', 16384, 8192, 512, 512, 40.42247009277344, -80.01315307617188, 140.02723693847656, -3.1228559017181396, '2022-11', '499 Simms St, Pittsburgh, Pennsylvania', 'gsv', FALSE, FALSE, NULL),
    -- rancagua
    ('8SrDQivpzea9sNRW5jPSuQ', 16384, 8192, 512, 512, -34.16975011464287, -70.7448222240127, 188.8830261230469, -0.30183, '2025-05', '372 Bueras, Rancagua, O''Higgins', 'gsv', FALSE, FALSE, NULL),
    -- seattle
    ('163cn2Zsro6U9cYN5Ghq5w', 16384, 8192, 512, 512, 47.51686477661133, -122.27181243896484, 89.82748413085938, 1.9808731079101562, '2018-09', '4901 S Roxbury St', 'gsv', TRUE, TRUE, NULL),
    ('19eciAwZwhYM09v6tFMsZg', 13312, 6656, 512, 512, 47.63362503051758, -122.30785369873047, 43.826969146728516, 3.699981689453125, '2017-07', '1721 Interlaken Dr E', 'gsv', FALSE, TRUE, NULL),
    ('2eTTyIzHKuN40UA6NMXblg', 16384, 8192, 512, 512, 47.68667221069336, -122.30062866210938, 88.58881378173828, 0.1136932373046875, '2018-07', '2524 NE 80th St', 'gsv', TRUE, TRUE, NULL),
    ('33UyDGRktYrpaFYeUCksIw', 16384, 8192, 512, 512, 47.678855895996094, -122.31198120117188, 359.36370849609375, -0.37955474853515625, '2018-10', '6902 15th Ave NE', 'gsv', TRUE, TRUE, NULL),
    ('3fsdgjVI9LG0Oti1_HQQQg', 16384, 8192, 512, 512, 47.5433349609375, -122.3915786743164, 178.57302856445312, 0.0795745849609375, '2018-08', '6698 Beveridge Pl SW', 'gsv', TRUE, TRUE, NULL),
    ('3tWwSd-yj5vEp_ACSmB-BA', 13312, 6656, 512, 512, 47.687896728515625, -122.32969665527344, 181.0595245361328, 2.7853927612304688, '2011-07', '8033 Sunnyside Ave N, Seattle, Washington', 'gsv', FALSE, FALSE, NULL),
    ('5WR1D3KWHQArOCOrExNu-A', 16384, 8192, 512, 512, 47.70246887207031, -122.36185455322266, 198.74110412597656, 3.48565673828125, '2019-04', '407 NW 101st St', 'gsv', TRUE, TRUE, NULL),
    ('6Gm_rYwqyRuNTvGSO5F9Fw', 16384, 8192, 512, 512, 47.53006362915039, -122.35501861572266, 86.45649719238281, -0.5861358642578125, '2018-09', '1599 SW Elmgrove St', 'gsv', TRUE, TRUE, NULL),
    ('7SOz85f6ntBS4-fyC5lglw', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2019-08', NULL, 'gsv', TRUE, FALSE, 'BcEBJbKOYj8rpdLLZEYU_A'),
    ('7gbiyTCCwaRGtxT1gihwiw', 16384, 8192, 512, 512, 47.67760467529297, -122.27518463134766, 273.1510314941406, -2.1355209350585938, '2019-05', '4902 NE 68th St', 'gsv', TRUE, TRUE, NULL),
    ('8EfkRGVrcWhnIYEQq71RmQ', 16384, 8192, 512, 512, 47.6973762512207, -122.37271118164062, 180.93431091308594, 1.321720004081726, '2019-04', NULL, 'gsv', TRUE, FALSE, 'Ms0lRCKBtvjjucp6a26SQA'),
    ('AsoOfUJMMp8e_1-VF5eZ_w', 16384, 8192, 512, 512, 47.575504302978516, -122.29202270507812, 94.32972717285156, -0.09635162353515625, '2019-07', '3202 S Hanford St', 'gsv', FALSE, TRUE, NULL),
    ('HEeOEO9QkHQTsTcJhkolEQ', 16384, 8192, 512, 512, 47.5022087097168, -122.37954711914062, 348.7957763671875, -1.8082046508789062, '2018-05', '11217 37th Ave SW', 'gsv', TRUE, TRUE, NULL),
    ('HuZgK8m1RhSJHwY6jSxLFg', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2021-07', NULL, 'gsv', TRUE, FALSE, 'MraGBsRbcci6EU8193By9A'),
    ('JRVRDCgg7KaRkyS54ogj_w', 16384, 8192, 512, 512, 47.63725280761719, -122.40715789794922, 314.6840515136719, 0.6595001220703125, '2019-05', '2221 Magnolia Blvd W', 'gsv', FALSE, TRUE, NULL),
    ('Kqr-5D8D3f5AyeYpzC-RWA', 16384, 8192, 512, 512, 47.605201721191406, -122.31877136230469, 90.3153305053711, 9.142723083496094, '2019-05', '1012 E Terrace St', 'gsv', FALSE, TRUE, NULL),
    ('LUBbUk8l7UEDUyM9WxQNkw', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2019-06', NULL, 'gsv', TRUE, FALSE, 'inbX7TbOHIUAQi7nRxgnXQ'),
    ('NQyrpvQLCPAwbdCHmCZpQA', 16384, 8192, 512, 512, 47.629398345947266, -122.36315155029297, 182.61537170410156, 12.710762023925781, '2018-06', '1198 5th Ave W', 'gsv', TRUE, TRUE, NULL),
    ('Naa3G5wf62hWam9OvLndHA', 16384, 8192, 512, 512, 47.67171859741211, -122.34977722167969, 90.42814636230469, 7.3287811279296875, '2018-07', '702 N 59th St', 'gsv', TRUE, TRUE, NULL),
    ('OaRYqAIyAWnBh697UeMAwA', 16384, 8192, 512, 512, 47.57978439331055, -122.285400390625, 121.84815979003906, -2.5980300903320312, '2019-07', '2602 Shoreland Dr S', 'gsv', TRUE, TRUE, NULL),
    ('OlKcvA2oHMeKnMSgrwPzUg', 13312, 6656, 512, 512, 47.608760833740234, -122.29264831542969, 181.01800537109375, -0.8218002319335938, '2015-06', '758 31st Ave', 'gsv', FALSE, TRUE, NULL),
    ('Q2jHOi8UYG6cstdjBxYRiQ', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-10', NULL, 'gsv', TRUE, FALSE, 'JH4YHTBXKD4Q8cs5Z_VLvA'),
    ('R3dahHNP_JQQKBdJvxtK8w', 16384, 8192, 512, 512, 47.61980056762695, -122.35543823242188, 0.6466708183288574, -2.1184539794921875, '2018-07', '200 1st Ave N', 'gsv', TRUE, TRUE, NULL),
    ('RM5ynT38lQZXXoDq-Y15Ww', 13312, 6656, 512, 512, 47.696712493896484, -122.28729248046875, 89.44735717773438, 2.7503890991210938, '2011-07', '3809 NE 94th St', 'gsv', FALSE, TRUE, NULL),
    ('RT_TOBm4DR_P8Ngb9tvZQA', 16384, 8192, 512, 512, 47.69782638549805, -122.3547134399414, 268.73779296875, 10.984603881835938, '2018-09', '352 N 95th St', 'gsv', TRUE, TRUE, NULL),
    ('WyoEFmZH9TUmA-1nnTnHDA', 16384, 8192, 512, 512, 47.70478057861328, -122.38247680664062, 49.282798767089844, -4.605278015136719, '2018-05', '1940 NW Blue Ridge Dr', 'gsv', TRUE, TRUE, NULL),
    ('Y5w1LkzWxDeCnGZ46bMv_Q', 16384, 8192, 512, 512, 47.68219757080078, -122.26177978515625, 223.87379455566406, -1.0718231201171875, '2018-10', 'NE 74th St', 'gsv', FALSE, TRUE, NULL),
    ('YO-6JIKAjzWBc2zDIDjeUA', 16384, 8192, 512, 512, 47.70079803466797, -122.39234924316406, 196.0467529296875, -5.031471252441406, '2021-07', NULL, 'gsv', TRUE, FALSE, 'WOyZkfW4GD9iwXpotzGr6Q'),
    ('Ye9h8vshRd7dfBnlkZNz9w', 16384, 8192, 512, 512, 47.554840087890625, -122.30493927001953, 240.73114013671875, 4.378900051116943, '2023-01', NULL, 'gsv', TRUE, FALSE, 'jYT2lS-gapy9Oo01LEJbvw'),
    ('Z_NoruJ0co4-SzBnIWG1eQ', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2019-06', NULL, 'gsv', TRUE, FALSE, 'GkVTC_6rvOHJ_PzF0upgiw'),
    ('b20aBLpJEOAvXsenV76cRQ', 13312, 6656, 512, 512, 47.615821838378906, -122.33670043945312, 289.4237060546875, 2.34210205078125, '2014-05', '2000 8th Ave', 'gsv', FALSE, TRUE, NULL),
    ('cDckO6g_Lx4vjqIWaYwceg', 16384, 8192, 512, 512, 47.63201904296875, -122.35563659667969, 359.9273376464844, 1.8566360473632812, '2019-05', '1430 1st Ave N', 'gsv', TRUE, TRUE, NULL),
    ('fzXxhDXdxC3FAcIoIMoixQ', 16384, 8192, 512, 512, 47.6364631652832, -122.40119934082031, 179.74783325195312, 2.6293106079101562, '2019-04', '1918 35th Ave W', 'gsv', TRUE, TRUE, NULL),
    ('iEnlNsenAb-0k-HJLaYB3A', 16384, 8192, 512, 512, 47.67914581298828, -122.32492065429688, 322.23828125, 0.9422836303710938, '2018-08', '398 NE Ravenna Blvd', 'gsv', TRUE, TRUE, NULL),
    ('kr6Vi6M-ZSkDlNJiOd8X3Q', 16384, 8192, 512, 512, 47.627403259277344, -122.29739379882812, 92.90422821044922, 8.532981872558594, '2019-06', '2628 E Ward St', 'gsv', FALSE, TRUE, NULL),
    ('mRm3DmJJVL0vq8RrI_3eDA', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2019-06', NULL, 'gsv', TRUE, FALSE, 'N8xpUxxkeNqpchjpeyQ9eQ'),
    ('nMbinrJwvbe9PSk4-ttiwA', 16384, 8192, 512, 512, 47.5837773770385, -122.3992984949745, 63.80302047729492, -10.81122, '2021-07', '2310 Halleck Ave SW, Seattle, Washington', 'gsv', FALSE, FALSE, NULL),
    ('pWV3kGtu0cU_WObd1XI7TQ', 16384, 8192, 512, 512, 47.63437271118164, -122.30567169189453, 35.57917404174805, 7.7011566162109375, '2018-07', '1654 20th Ave E', 'gsv', TRUE, TRUE, NULL),
    ('ut-7ZUPPSOXQFgV7vTWnPQ', 16384, 8192, 512, 512, 47.613067626953125, -122.33650970458984, 57.89463424682617, 1.5666656494140625, '2019-05', '572 Olive Way', 'gsv', TRUE, TRUE, NULL),
    ('wDYBnhAHVGwJmJB6XGKYlA', 16384, 8192, 512, 512, 47.69843292236328, -122.2986068725586, 90.14570617675781, -4.529899597167969, '2018-07', '2705 NE 96th St', 'gsv', TRUE, TRUE, NULL),
    ('xUdYQ-if1m-pBtQqVQkXnQ', 16384, 8192, 512, 512, 47.53908920288086, -122.29146575927734, 202.2029571533203, 1.4748200178146362, '2023-01', NULL, 'gsv', TRUE, FALSE, 'wwq-iJg_tWNbYHaHL5K8Aw'),
    -- spgg
    ('09KBXXHZb5gxExZ8_E7VDQ', 16384, 8192, 512, 512, 25.683456420898438, -100.40866088867188, 141.2141876220703, 4.362953186035156, '2019-07', NULL, 'gsv', TRUE, FALSE, 'C0Yc3SS2c8IbQxUMlDmYlA'),
    ('0g-6z5F8OmrP6Bk9VrJf0Q', 13312, 6656, 512, 512, 25.643199920654297, -100.37848663330078, 287.04656982421875, -0.5410308837890625, '2014-10', '229 Moralillo', 'gsv', FALSE, TRUE, NULL),
    ('6wUK3_fIoHfIBysXOuYpXw', 16384, 8192, 512, 512, 25.644357681274414, -100.38330841064453, 5.145268440246582, 5.8901824951171875, '2019-08', '913 Convento, Monterrey, Nuevo Leon', 'gsv', FALSE, FALSE, NULL),
    ('AnxxpLJBUGPQDqYNYvRskA', 16384, 8192, 512, 512, 25.644149780273438, -100.32453155517578, 302.09527587890625, -0.6859664916992188, '2019-07', '329 José Clemente Orozco, San Pedro Garza García, Nuevo Leon', 'gsv', FALSE, FALSE, NULL),
    ('DGSyoGxrJhnc_m2ZFM_BUg', 16384, 8192, 512, 512, 38.940547943115234, -77.06410217285156, 302.13409423828125, -1.996551513671875, '2019-06', '3099 Sedgwick St NW', 'gsv', FALSE, TRUE, NULL),
    ('KXZHOh-NdsaEWyaw3S6zgw', 13312, 6656, 512, 512, 25.64383316040039, -100.38078308105469, 84.19290161132812, 0.8477554321289062, '2019-04', '111 Moralillo', 'gsv', FALSE, TRUE, NULL),
    ('MIRxuKxQ5bv2Yx2Aby36fQ', 16384, 8192, 512, 512, 25.680326461791992, -100.41394805908203, 282.2384338378906, -0.9594039916992188, '2019-08', '801 Av. Manuel J. Clouthier', 'gsv', TRUE, TRUE, NULL),
    ('OH77Pz49WJDrNGkvY-I3yA', 13312, 6656, 512, 512, 25.638507843017578, -100.37749481201172, 184.3066864013672, -0.8163909912109375, '2019-04', '366 Mirador de La Sierra', 'gsv', FALSE, TRUE, NULL),
    ('U-Y6a8H2jUVGYZG0VSkpDw', 13312, 6656, 512, 512, 25.658403396606445, -100.37496185302734, 106.22126770019531, -0.7561264038085938, '2019-04', NULL, 'gsv', FALSE, TRUE, NULL),
    ('Vsl0VUCglz4b9QoMh087JQ', 16384, 8192, 512, 512, 25.680316925048828, -100.41390228271484, 282.4034423828125, -1.349365234375, '2019-08', '801 Av. Manuel J. Clouthier', 'gsv', FALSE, TRUE, NULL),
    ('_5WmUTyJ0Wf27M4uMlotEw', 16384, 8192, 512, 512, 25.63347816467285, -100.38388061523438, 73.41984558105469, 1.4052505493164062, '2019-08', '705 Olmos', 'gsv', FALSE, TRUE, NULL),
    ('kM40VuLkfC55W6l2nDZWSg', 16384, 8192, 512, 512, 25.64314079284668, -100.35279846191406, 359.12066650390625, 1.1964874267578125, '2019-08', 'Av. Ricardo Margain Zozaya', 'gsv', TRUE, TRUE, NULL),
    ('r5KKjGPvnopdtE3ijdMGCg', 16384, 8192, 512, 512, 25.64444923400879, -100.38330078125, 6.714115142822266, 5.8702239990234375, '2019-08', '212 Convento, Monterrey, Nuevo Leon', 'gsv', FALSE, FALSE, NULL),
    ('uswgjnwrL8ITnfgfekWqnA', 16384, 8192, 512, 512, 25.644166946411133, -100.3833236694336, 5.657079696655273, 5.23583984375, '2019-08', '913 Convento, Monterrey, Nuevo Leon', 'gsv', FALSE, FALSE, NULL),
    -- st_louis
    ('79BRT9XMouA8Td-itqa38A', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-10', NULL, 'gsv', TRUE, FALSE, 'UQssYsgn4YVbRC1qfrSlJw'),
    ('Ltl-yoTsk2kpxcrXNsHAmg', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-05', NULL, 'gsv', TRUE, FALSE, 'b_4l7bjmeO0kBIMOf5Y4-A'),
    ('b-Dt6YG8Gy45D3AB8RoAQg', 16384, 8192, 512, 512, 38.57248464788082, -90.23797290619625, 189.2263336181641, 0.87015, '2022-05', '4615 Pennsylvania Ave, St. Louis, Missouri', 'gsv', FALSE, FALSE, NULL),
    ('cpOyVRzm51PeOVvbvxu2DA', 16384, 8192, 512, 512, 38.56972286883103, -90.24261053981684, 98.15078735351562, -3.00487, '2022-10', '3212 Delor St, St. Louis, Missouri', 'gsv', FALSE, FALSE, NULL),
    ('jQi5BwjIo37VItW8mayJ-w', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-05', NULL, 'gsv', TRUE, FALSE, 'X7J-BJ7xc47WecC7SbOnVQ'),
    ('o1BlH_25423Ctt_O0-4qzw', 16384, 8192, 512, 512, 38.56206960358706, -90.25099244343507, 123.6521530151367, -0.14066, '2022-05', '615 Fillmore St, St. Louis, Missouri', 'gsv', FALSE, FALSE, NULL),
    ('vCVdq9koLiDFYM1rN_GNDw', 16384, 8192, 512, 512, 38.57488083869463, -90.24600689146544, 32.83821105957031, -1.51804, '2022-10', '4633 Louisiana Ave, St. Louis, Missouri', 'gsv', FALSE, FALSE, NULL),
    ('vHe-cpDwK5tkhO7bu7sYow', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-05', NULL, 'gsv', TRUE, FALSE, '5-iBaza3ixXG64sdXhQhiw'),
    -- teaneck
    ('F3-YO9gBYSCFOn1hVaOspQ', 16384, 8192, 512, 512, NULL, NULL, NULL, NULL, '2022-02', NULL, 'gsv', TRUE, FALSE, 'LcwJzTClsrdj7E-pcQ9jvw'),
    -- zurich_infra3d
    ('649bb964-d0d9-1b13-04de-84858aaf667b', 16064, 8032, 502, 502, 47.3910873139, 8.5209673464, 287.8103226747415, 1.7308326781511458, '2024-06', NULL, 'infra3d', FALSE, NULL, NULL)
) AS recovered(pano_id, width, height, tile_width, tile_height, lat, lng, camera_heading, camera_pitch, capture_date,
               address, source, expired, has_backup, date_source_pano),
LATERAL (SELECT max(time_created) AS last_labeled FROM label WHERE label.pano_id = recovered.pano_id) AS seen
WHERE seen.last_labeled IS NOT NULL
ON CONFLICT (pano_id) DO NOTHING;


-- PART 3 (#4587): the point of the two parts above. Every label now has a pano_data row, so make it structural
-- rather than merely true -- a label written without its pano metadata was silently accepted for years.
--
-- Validated inline rather than added NOT VALID and validated later. The NOT VALID split exists to keep a
-- write-blocking lock short on a large table, but it cannot help here: evolutions share one transaction, so the
-- ADD's lock is held to commit either way, and the split would only pay off across two deploys at the cost of
-- shipping an unproven constraint. The scan is 210 ms on seattle, the largest schema at 319k labels, since
-- label_pano_id_idx and pano_data's primary key both back it.
ALTER TABLE label ADD CONSTRAINT label_pano_id_fkey FOREIGN KEY (pano_id) REFERENCES pano_data (pano_id);


# --- !Downs
-- First, so the deletes below can put the labels back to referencing panos that have no row.
ALTER TABLE label DROP CONSTRAINT label_pano_id_fkey;

-- last_checked is what distinguishes the rows this evolution wrote from ones a client wrote for the same pano: the
-- Up stamps its own literal, a live write stamps now(). Without that guard a pano someone visits between now and
-- deploy -- whose row the Up then skips via ON CONFLICT -- would be deleted here, losing real metadata and failing
-- outright against pano_link's foreign key. If the expiry sweep has since restamped last_checked the row is left
-- behind instead, which is the safe direction to err.
DELETE FROM pano_data
WHERE last_checked = '2026-08-21'
  AND pano_id IN (
    'IU6xDOn1LzV6WnYPg7R4uw', 'UPxzd1SPIA5o4udTq_qp3A', 'ZnN1k5cb8jn8x-DT4p51wQ', '_bo4xBh2TEw5odDce9nAvQ',
    'CJ-QFkxbDhjftegCSpcSFw', 'SQEvsqD7xBEbvBS8lBZhog', 'V2eMH3rj_m8FaMQvAh-qkg', 'k3xWZof11YvVJ3cpOaPotA',
    'rFnokTwtWlFqZJb0xWtRrQ', 'uZ1jHx62NoDiEM3VBAAy6g', 'x9n7BzN6G-8DytRqgszuzg', '99AnoYWD5cp5H3lP1bmK7Q',
    'AP7knM-He3aCfhM07x4F8A', 'N-sqXHmUyEIEh7eQ7iLclA', 'N6wBj0m4ssrd5SNy8Q8TIw', 'vxb4UcwquGq2lxLfUO3pkA',
    'w2UeYrc0gXBzu-JAklOFyA', 'C2If792tPUzWMGyr6r82Ig', 'tWmYM9hAKJ0EJ7rZv-IDKQ', 'E_88NCDwjxY5DsGxBMyJ_g',
    'DrUDuDms60T5w1GkuuUGLA', 'Jv2v3MvzOAwigHwVnlUkWQ', 'YqBHER_txEVysk6JiOMj0A', '_yK0yAc9IDoRc9FwLRMyNg',
    'fnb5GJbzBKNYkTbiJsCTJw', '13Ry-9C6VcZfJZDvYZ8Akg', 'zFozhKJOeXovqj_lQAhWpg', '1CyCSX-ZcgaOSbf71Hc2XQ',
    'ZDivi4KZ-NZoXklA1_gznA', 'ua5L1w72YO7EfGkCzsImAQ', 'rVjnY_Xz7gHyJsKd7xpZ0A', 'HUyAJCgNt4BiU8Y9YuTgUw',
    '8SrDQivpzea9sNRW5jPSuQ', '163cn2Zsro6U9cYN5Ghq5w', '19eciAwZwhYM09v6tFMsZg', '2eTTyIzHKuN40UA6NMXblg',
    '33UyDGRktYrpaFYeUCksIw', '3fsdgjVI9LG0Oti1_HQQQg', '3tWwSd-yj5vEp_ACSmB-BA', '5WR1D3KWHQArOCOrExNu-A',
    '6Gm_rYwqyRuNTvGSO5F9Fw', '7SOz85f6ntBS4-fyC5lglw', '7gbiyTCCwaRGtxT1gihwiw', '8EfkRGVrcWhnIYEQq71RmQ',
    'AsoOfUJMMp8e_1-VF5eZ_w', 'HEeOEO9QkHQTsTcJhkolEQ', 'HuZgK8m1RhSJHwY6jSxLFg', 'JRVRDCgg7KaRkyS54ogj_w',
    'Kqr-5D8D3f5AyeYpzC-RWA', 'LUBbUk8l7UEDUyM9WxQNkw', 'NQyrpvQLCPAwbdCHmCZpQA', 'Naa3G5wf62hWam9OvLndHA',
    'OaRYqAIyAWnBh697UeMAwA', 'OlKcvA2oHMeKnMSgrwPzUg', 'Q2jHOi8UYG6cstdjBxYRiQ', 'R3dahHNP_JQQKBdJvxtK8w',
    'RM5ynT38lQZXXoDq-Y15Ww', 'RT_TOBm4DR_P8Ngb9tvZQA', 'WyoEFmZH9TUmA-1nnTnHDA', 'Y5w1LkzWxDeCnGZ46bMv_Q',
    'YO-6JIKAjzWBc2zDIDjeUA', 'Ye9h8vshRd7dfBnlkZNz9w', 'Z_NoruJ0co4-SzBnIWG1eQ', 'b20aBLpJEOAvXsenV76cRQ',
    'cDckO6g_Lx4vjqIWaYwceg', 'fzXxhDXdxC3FAcIoIMoixQ', 'iEnlNsenAb-0k-HJLaYB3A', 'kr6Vi6M-ZSkDlNJiOd8X3Q',
    'mRm3DmJJVL0vq8RrI_3eDA', 'nMbinrJwvbe9PSk4-ttiwA', 'pWV3kGtu0cU_WObd1XI7TQ', 'ut-7ZUPPSOXQFgV7vTWnPQ',
    'wDYBnhAHVGwJmJB6XGKYlA', 'xUdYQ-if1m-pBtQqVQkXnQ', '09KBXXHZb5gxExZ8_E7VDQ', '0g-6z5F8OmrP6Bk9VrJf0Q',
    '6wUK3_fIoHfIBysXOuYpXw', 'AnxxpLJBUGPQDqYNYvRskA', 'DGSyoGxrJhnc_m2ZFM_BUg', 'KXZHOh-NdsaEWyaw3S6zgw',
    'MIRxuKxQ5bv2Yx2Aby36fQ', 'OH77Pz49WJDrNGkvY-I3yA', 'U-Y6a8H2jUVGYZG0VSkpDw', 'Vsl0VUCglz4b9QoMh087JQ',
    '_5WmUTyJ0Wf27M4uMlotEw', 'kM40VuLkfC55W6l2nDZWSg', 'r5KKjGPvnopdtE3ijdMGCg', 'uswgjnwrL8ITnfgfekWqnA',
    '79BRT9XMouA8Td-itqa38A', 'Ltl-yoTsk2kpxcrXNsHAmg', 'b-Dt6YG8Gy45D3AB8RoAQg', 'cpOyVRzm51PeOVvbvxu2DA',
    'jQi5BwjIo37VItW8mayJ-w', 'o1BlH_25423Ctt_O0-4qzw', 'vCVdq9koLiDFYM1rN_GNDw', 'vHe-cpDwK5tkhO7bu7sYow',
    'F3-YO9gBYSCFOn1hVaOspQ', '649bb964-d0d9-1b13-04de-84858aaf667b'
);

-- The tutorial rows stay, reassigned to the source they all held before -- dropping the enum value only requires
-- that nothing uses it, and deleting a pano_data row that an interaction table may reference is a worse trade than
-- leaving two harmless rows of fabricated metadata behind. Their pre-Up values aren't restored either: the 20
-- cities that had a 'tutorial' row held four different value sets between them, all stale. So a rollback lands on
-- the old filters' behavior, #4773's leak of 'afterWalkTutorial' into /adminapi/panos included.
--
-- The tutorial flag also stays set. Which labels held FALSE isn't recoverable without a backup of the 181 ids, and
-- the flag is a correction: leaving them out of the API errs toward hiding data we know is wrong.
ALTER TABLE pano_data ALTER COLUMN source TYPE TEXT USING source::text;
UPDATE pano_data SET source = 'gsv' WHERE pano_id IN ('tutorial', 'afterWalkTutorial');
DROP TYPE pano_source;
CREATE TYPE pano_source AS ENUM ('gsv', 'mapillary', 'infra3d');
ALTER TABLE pano_data ALTER COLUMN source TYPE pano_source USING source::pano_source;
