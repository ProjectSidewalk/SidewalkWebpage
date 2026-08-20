# --- !Ups
-- #4587/#4773: close most of the gap between `label` and `pano_data`, in two independent parts -- the synthetic
-- tutorial panos (below) and 45 real panos recovered from the image store (further down).
--
-- PART 1: give the two locally-served tutorial panos real pano_data rows, marked with a `tutorial` pano_source.
--
-- The tutorial runs on synthetic panos ('tutorial', 'afterWalkTutorial') whose imagery is app assets, not provider
-- imagery. #4773 kept them out of pano_data entirely, but that makes the FK label.pano_id -> pano_data.pano_id
-- unreachable: 8,803 of the 8,910 prod labels with no pano_data row are tutorial labels, and the rule regenerates
-- them on every tutorial run. The leak #4773 was closing -- a synthetic pano reaching /adminapi/panos and being
-- handed to the scraper as real imagery -- is a filtering problem, and `source` filters it in a way a mistyped id
-- literal cannot defeat. PanoSource.providerCheckedSources = {Gsv, Mapillary} already gates every provider-facing
-- path, so the new value keeps CheckImageExpiryActor from asking Google about an id that cannot exist. It has been
-- asking: 19 of the 20 existing 'tutorial' rows are marked expired from its ZERO_RESULTS answers.
--
-- Values come from GsvViewer.#getCustomPanoData, which is what the viewer serves and what the client computes each
-- label's pano_x/pano_y against. camera_pitch is negated there (cameraPitch = -originPitch), so originPitch
-- -1.13769 is stored as 1.13769. expired is FALSE: the imagery is ours and cannot go away.
--
-- KNOWN AND DELIBERATELY NOT FIXED: tutorial labels created before ~2023-05 hold pano_x/pano_y on a 13312x6656
-- grid, because evolution 179 converted them against the row this one replaces. Their coordinates therefore
-- disagree with the row by 3.25x in width. Re-projecting them from label_point's viewport record would fix it, but
-- nothing reads tutorial label positions -- the LabelDetail popup included -- so the ~98k affected rows are left
-- alone rather than rewritten across 54 schemas (#4587 discussion, 2026-08-20).

-- Rebuild the type rather than ALTER TYPE ... ADD VALUE: evolutions share one transaction (autocommit=false in
-- application.conf), so a value added here could not be used by the upsert below -- "unsafe use of new value". A type
-- created inside the current transaction carries no such restriction (342.sql/352.sql mechanics). pano_data.source is
-- the type's only column anywhere, so this is the whole rebuild.
ALTER TABLE pano_data ALTER COLUMN source TYPE TEXT USING source::text;
DROP TYPE pano_source;
CREATE TYPE pano_source AS ENUM ('gsv', 'mapillary', 'infra3d', 'tutorial');

-- Insert where absent (34 cities lack the 'tutorial' row, 1 lacks 'afterWalkTutorial'), correct where present. Only
-- the columns describing the imagery are overwritten: last_viewed and has_backup record real usage and on-disk state,
-- and pano_history_saved/source_metadata are untouched for the same reason.
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
-- of them (2023-2026) were placed while auditing the DC tutorial street, which #4179 stopped serving during normal
-- missions, and 92 (2019-2020) are the opening labels of a first audit mission, saved before the viewer's pano id
-- caught up. `tutorial` is what every consumer filters on, and these are not real-world observations -- flag them.
-- Deleted ones included, so that no label on a synthetic pano claims to be one. Their users' user_stat counts are
-- computed with tutorial = FALSE and want a recompute on rollout, which the nightly refresh also does.
UPDATE label SET tutorial = TRUE WHERE pano_id IN ('tutorial', 'afterWalkTutorial') AND NOT tutorial;


-- PART 2 (#4587): restore pano_data for 45 panos whose metadata write was lost, covering 74 labels across 6 cities.
--
-- Until v11.8.1 (#4869) the pano metadata write was fire-and-forget, so a label could be committed while its
-- pano_data row was silently dropped. 157 labels on 98 panos across prod still carry the damage. These 45 are the
-- ones we can recover offline: their metadata survives as cbk XML sidecars in the pano image store, because until
-- 2022-03-14 (aac479231) the scraper's work list came from the label table rather than from pano_data, so panos
-- with no row were still scraped. Every pano first labeled before that date has a sidecar, and none after it does.
--
-- Provenance and accuracy, from a 300-pano calibration against panos that have both a sidecar and a known-good row
-- (scratchpad/4587-store-calibration-list.sql):
--   * lat/lng come from the sidecar's `original_*` pair, which is the raw camera position pano_data stores --
--     median 0.256 m from the live value, against 2.421 m for the `lat`/`lng` pair, which is road-snapped.
--   * camera_heading is `pano_yaw_deg` unmodified -- median 0.011 deg, 263 of 300 within the 0.18 deg record
--     tolerance.
--   * width, height and capture_date matched exactly on all 300.
-- camera_pitch is left NULL: the sidecar carries a tilt vector (tilt_pitch_deg/tilt_yaw_deg), not the JS API's
-- originPitch that pano_data holds, and no conversion between them is established. Nothing needs it here -- the
-- position estimator uses lat/lng, camera_heading and the image dimensions.
--
-- has_backup is TRUE because the store scan found the image for all 45, so a label on an expired pano still renders.
-- expired stays FALSE ("not known to be expired") with last_checked set to when the pano was last labeled, which is
-- the last time we know someone saw it. That date is years old, so CheckImageExpiryActor picks these up in its next
-- sweep and settles the question rather than this evolution guessing.
--
-- The EXISTS-style join on label is what keeps each schema to its own panos: pano ids are global, so an unguarded
-- insert would seed every city with all 45.
INSERT INTO pano_data (pano_id, width, height, tile_width, tile_height, lat, lng, camera_heading, capture_date,
                       address, source, expired, has_backup, last_viewed, last_checked)
SELECT recovered.pano_id, recovered.width, recovered.height, recovered.tile_width, recovered.tile_height,
       recovered.lat, recovered.lng, recovered.camera_heading, recovered.capture_date, recovered.address,
       'gsv', FALSE, TRUE, seen.last_labeled, seen.last_labeled
FROM (VALUES
    ('ZnN1k5cb8jn8x-DT4p51wQ', 16384, 8192, 512, 512, 52.399881, 4.943231, 283.24, '2020-08', 'IJdoornlaan'),
    ('CJ-QFkxbDhjftegCSpcSFw', 16384, 8192, 512, 512, 19.481463, -99.174598, 4.2, '2019-09', '395 Eje 4 Pte'),
    ('k3xWZof11YvVJ3cpOaPotA', 16384, 8192, 512, 512, 19.485829, -99.190281, 43.71, '2019-04', '394 Rey Maxtla'),
    ('uZ1jHx62NoDiEM3VBAAy6g', 16384, 8192, 512, 512, 19.501239, -99.195752, 285.57, '2019-07', '303 Calz. de los Angeles'),
    ('x9n7BzN6G-8DytRqgszuzg', 16384, 8192, 512, 512, 19.476663, -99.160298, 10.83, '2019-03', '25 Guam'),
    ('C2If792tPUzWMGyr6r82Ig', 16384, 8192, 512, 512, 39.971429, -83.009529, 183.36, '2019-07', '463 Neil Ave'),
    ('fnb5GJbzBKNYkTbiJsCTJw', 13312, 6656, 512, 512, 45.330514, -122.971685, 230.11, '2018-09', '25935 NE North Valley Rd'),
    ('163cn2Zsro6U9cYN5Ghq5w', 16384, 8192, 512, 512, 47.516865, -122.271812, 89.77, '2018-09', '4901 S Roxbury St'),
    ('19eciAwZwhYM09v6tFMsZg', 13312, 6656, 512, 512, 47.633626, -122.307855, 43.829998, '2017-07', '1721 Interlaken Dr E'),
    ('2eTTyIzHKuN40UA6NMXblg', 16384, 8192, 512, 512, 47.686670, -122.300628, 88.59, '2018-07', '2524 NE 80th St'),
    ('33UyDGRktYrpaFYeUCksIw', 16384, 8192, 512, 512, 47.678853, -122.311982, 359.34, '2018-10', '6902 15th Ave NE'),
    ('3fsdgjVI9LG0Oti1_HQQQg', 16384, 8192, 512, 512, 47.543334, -122.391577, 178.73999, '2018-08', '6698 Beveridge Pl SW'),
    ('5WR1D3KWHQArOCOrExNu-A', 16384, 8192, 512, 512, 47.702469, -122.361855, 198.73999, '2019-04', '407 NW 101st St'),
    ('6Gm_rYwqyRuNTvGSO5F9Fw', 16384, 8192, 512, 512, 47.530066, -122.354824, 87.09, '2018-09', '1599 SW Elmgrove St'),
    ('7gbiyTCCwaRGtxT1gihwiw', 16384, 8192, 512, 512, 47.677603, -122.275185, 273.15, '2019-05', '4902 NE 68th St'),
    ('AsoOfUJMMp8e_1-VF5eZ_w', 16384, 8192, 512, 512, 47.575504, -122.292013, 93.909996, '2019-07', '3202 S Hanford St'),
    ('HEeOEO9QkHQTsTcJhkolEQ', 16384, 8192, 512, 512, 47.502207, -122.379544, 348.8, '2018-05', '11217 37th Ave SW'),
    ('JRVRDCgg7KaRkyS54ogj_w', 16384, 8192, 512, 512, 47.637189, -122.407064, 314.63998, '2019-05', '2221 Magnolia Blvd W'),
    ('Kqr-5D8D3f5AyeYpzC-RWA', 16384, 8192, 512, 512, 47.605203, -122.318773, 90.32, '2019-05', '1012 E Terrace St'),
    ('NQyrpvQLCPAwbdCHmCZpQA', 16384, 8192, 512, 512, 47.629397, -122.363153, 182.67, '2018-06', '1198 5th Ave W'),
    ('Naa3G5wf62hWam9OvLndHA', 16384, 8192, 512, 512, 47.671720, -122.349771, 90.29, '2018-07', '702 N 59th St'),
    ('OaRYqAIyAWnBh697UeMAwA', 16384, 8192, 512, 512, 47.579785, -122.285403, 121.85, '2019-07', '2602 Shoreland Dr S'),
    ('OlKcvA2oHMeKnMSgrwPzUg', 13312, 6656, 512, 512, 47.608759, -122.292645, 181.04, '2015-06', '758 31st Ave'),
    ('R3dahHNP_JQQKBdJvxtK8w', 16384, 8192, 512, 512, 47.619800, -122.355444, 0.66999996, '2018-07', '200 1st Ave N'),
    ('RM5ynT38lQZXXoDq-Y15Ww', 13312, 6656, 512, 512, 47.696714, -122.287295, 89.45, '2011-07', '3809 NE 94th St'),
    ('RT_TOBm4DR_P8Ngb9tvZQA', 16384, 8192, 512, 512, 47.697828, -122.354710, 268.74, '2018-09', '352 N 95th St'),
    ('WyoEFmZH9TUmA-1nnTnHDA', 16384, 8192, 512, 512, 47.704832, -122.382373, 58.17, '2018-05', '1940 NW Blue Ridge Dr'),
    ('Y5w1LkzWxDeCnGZ46bMv_Q', 16384, 8192, 512, 512, 47.682199, -122.261782, 223.87, '2018-10', 'NE 74th St'),
    ('b20aBLpJEOAvXsenV76cRQ', 13312, 6656, 512, 512, 47.615823, -122.336704, 289.4, '2014-05', '2000 8th Ave'),
    ('cDckO6g_Lx4vjqIWaYwceg', 16384, 8192, 512, 512, 47.632020, -122.355634, 359.93, '2019-05', '1430 1st Ave N'),
    ('fzXxhDXdxC3FAcIoIMoixQ', 16384, 8192, 512, 512, 47.636463, -122.401203, 179.7, '2019-04', '1918 35th Ave W'),
    ('iEnlNsenAb-0k-HJLaYB3A', 16384, 8192, 512, 512, 47.679145, -122.324922, 322.24, '2018-08', '398 NE Ravenna Blvd'),
    ('kr6Vi6M-ZSkDlNJiOd8X3Q', 16384, 8192, 512, 512, 47.627402, -122.297393, 92.85, '2019-06', '2628 E Ward St'),
    ('pWV3kGtu0cU_WObd1XI7TQ', 16384, 8192, 512, 512, 47.634374, -122.305675, 35.579998, '2018-07', '1654 20th Ave E'),
    ('ut-7ZUPPSOXQFgV7vTWnPQ', 16384, 8192, 512, 512, 47.613067, -122.336507, 57.89, '2019-05', '572 Olive Way'),
    ('wDYBnhAHVGwJmJB6XGKYlA', 16384, 8192, 512, 512, 47.698431, -122.298603, 90.03, '2018-07', '2705 NE 96th St'),
    ('0g-6z5F8OmrP6Bk9VrJf0Q', 13312, 6656, 512, 512, 25.643199, -100.378479, 286.97, '2014-10', '229 Moralillo'),
    -- A real Washington DC pano labeled inside the Monterrey schema, sidecar address and all. Left where it is:
    -- moving it is a separate question from restoring its metadata.
    ('DGSyoGxrJhnc_m2ZFM_BUg', 16384, 8192, 512, 512, 38.940550, -77.064101, 302.13, '2019-06', '3099 Sedgwick St NW'),
    ('KXZHOh-NdsaEWyaw3S6zgw', 13312, 6656, 512, 512, 25.643829, -100.380775, 84.2, '2019-04', '111 Moralillo'),
    ('MIRxuKxQ5bv2Yx2Aby36fQ', 16384, 8192, 512, 512, 25.680330, -100.413951, 278.4264, '2019-08', '801 Av. Manuel J. Clouthier'),
    ('OH77Pz49WJDrNGkvY-I3yA', 13312, 6656, 512, 512, 25.638512, -100.377496, 184.39, '2019-04', '366 Mirador de La Sierra'),
    ('U-Y6a8H2jUVGYZG0VSkpDw', 13312, 6656, 512, 512, 25.658404, -100.374966, 106.22, '2019-04', NULL),
    ('Vsl0VUCglz4b9QoMh087JQ', 16384, 8192, 512, 512, 25.680321, -100.413903, 283.02393, '2019-08', '801 Av. Manuel J. Clouthier'),
    ('_5WmUTyJ0Wf27M4uMlotEw', 16384, 8192, 512, 512, 25.633484, -100.383891, 73.74, '2019-08', '705 Olmos'),
    ('kM40VuLkfC55W6l2nDZWSg', 16384, 8192, 512, 512, 25.643152, -100.352808, 359.13998, '2019-08', 'Av. Ricardo Margain Zozaya')
) AS recovered(pano_id, width, height, tile_width, tile_height, lat, lng, camera_heading, capture_date, address),
LATERAL (SELECT max(time_created) AS last_labeled FROM label WHERE label.pano_id = recovered.pano_id) AS seen
WHERE seen.last_labeled IS NOT NULL
ON CONFLICT (pano_id) DO NOTHING;


# --- !Downs
-- Safe as a plain delete: every row above went into a schema where the pano had no row, and nothing can have come
-- to reference one since -- a label already pointing at it is what selected it, and labels are never deleted here.
DELETE FROM pano_data WHERE pano_id IN (
    'ZnN1k5cb8jn8x-DT4p51wQ', 'CJ-QFkxbDhjftegCSpcSFw', 'k3xWZof11YvVJ3cpOaPotA', 'uZ1jHx62NoDiEM3VBAAy6g',
    'x9n7BzN6G-8DytRqgszuzg', 'C2If792tPUzWMGyr6r82Ig', 'fnb5GJbzBKNYkTbiJsCTJw', '163cn2Zsro6U9cYN5Ghq5w',
    '19eciAwZwhYM09v6tFMsZg', '2eTTyIzHKuN40UA6NMXblg', '33UyDGRktYrpaFYeUCksIw', '3fsdgjVI9LG0Oti1_HQQQg',
    '5WR1D3KWHQArOCOrExNu-A', '6Gm_rYwqyRuNTvGSO5F9Fw', '7gbiyTCCwaRGtxT1gihwiw', 'AsoOfUJMMp8e_1-VF5eZ_w',
    'HEeOEO9QkHQTsTcJhkolEQ', 'JRVRDCgg7KaRkyS54ogj_w', 'Kqr-5D8D3f5AyeYpzC-RWA', 'NQyrpvQLCPAwbdCHmCZpQA',
    'Naa3G5wf62hWam9OvLndHA', 'OaRYqAIyAWnBh697UeMAwA', 'OlKcvA2oHMeKnMSgrwPzUg', 'R3dahHNP_JQQKBdJvxtK8w',
    'RM5ynT38lQZXXoDq-Y15Ww', 'RT_TOBm4DR_P8Ngb9tvZQA', 'WyoEFmZH9TUmA-1nnTnHDA', 'Y5w1LkzWxDeCnGZ46bMv_Q',
    'b20aBLpJEOAvXsenV76cRQ', 'cDckO6g_Lx4vjqIWaYwceg', 'fzXxhDXdxC3FAcIoIMoixQ', 'iEnlNsenAb-0k-HJLaYB3A',
    'kr6Vi6M-ZSkDlNJiOd8X3Q', 'pWV3kGtu0cU_WObd1XI7TQ', 'ut-7ZUPPSOXQFgV7vTWnPQ', 'wDYBnhAHVGwJmJB6XGKYlA',
    '0g-6z5F8OmrP6Bk9VrJf0Q', 'DGSyoGxrJhnc_m2ZFM_BUg', 'KXZHOh-NdsaEWyaw3S6zgw', 'MIRxuKxQ5bv2Yx2Aby36fQ',
    'OH77Pz49WJDrNGkvY-I3yA', 'U-Y6a8H2jUVGYZG0VSkpDw', 'Vsl0VUCglz4b9QoMh087JQ', '_5WmUTyJ0Wf27M4uMlotEw',
    'kM40VuLkfC55W6l2nDZWSg'
);

-- The rows stay, reassigned to the source they all held before. Dropping the `tutorial` enum value only requires
-- that nothing uses it, and the rows themselves are fabricated metadata for panos we serve as app assets -- there is
-- no observation here to lose, and deleting a pano_data row that gallery_task_interaction or
-- validation_task_interaction may reference is a worse trade than leaving two harmless rows behind. Restoring the
-- pre-Up values isn't attempted either: the 20 cities that had a 'tutorial' row held four different value sets
-- between them, all of them stale (see above). A rollback therefore lands on the old filters' behavior, including
-- #4773's leak of 'afterWalkTutorial' into /adminapi/panos.
-- The tutorial flag stays set. Which labels held FALSE isn't recoverable without a backup of the 181 ids, and the
-- flag is a correction: a rollback that leaves them out of the API errs toward hiding data we know is wrong.
ALTER TABLE pano_data ALTER COLUMN source TYPE TEXT USING source::text;
UPDATE pano_data SET source = 'gsv' WHERE pano_id IN ('tutorial', 'afterWalkTutorial');
DROP TYPE pano_source;
CREATE TYPE pano_source AS ENUM ('gsv', 'mapillary', 'infra3d');
ALTER TABLE pano_data ALTER COLUMN source TYPE pano_source USING source::pano_source;
