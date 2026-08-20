# --- !Ups
-- #4587/#4773: give the two locally-served tutorial panos real pano_data rows, marked with a `tutorial` pano_source.
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


# --- !Downs
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
