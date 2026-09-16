# --- !Ups
-- Unwraps the attribution the AI labeler composed around a Mapillary or Panoramax contributor's name in
-- pano_data.copyright, "© jacobwhall / Mapillary (CC BY-SA 4.0)" or "© Arretche / Panoramax (CC-BY-SA-4.0)", back to
-- the bare name the live viewers record, "jacobwhall" (#5360). ImageryAttribution composes the sign, the provider and
-- the licence around the column itself, so the wrapped form read "© © jacobwhall / Mapillary (CC BY-SA 4.0) ·
-- Mapillary · CC BY-SA 4.0" wherever a crop or a self-hosted pano is shown. A wrapper naming only the provider
-- recorded no contributor, so it becomes NULL, which is how the column reads that. The expressions are the ones
-- ImageryAttribution.normalizeCopyright now applies to every submission, so no such row is written again, and the
-- trim is a regexp rather than btrim so the stored value is exactly what that Scala path would store (String.trim
-- strips tabs and newlines too, btrim only spaces).
-- pano_data has no index on source or copyright, so each statement is one sequential scan of the table, under a
-- second on the largest schema, and only rows whose copyright carries the sign, the provider's name or an edge
-- space are rewritten.
-- source is compared as text because 375 added 'panoramax' to the enum with ADD VALUE, and a database that applies
-- 375 and this in one batch (the CI seed, a dev schema behind 375) has not committed that label yet, which Postgres
-- refuses to use as an enum literal (docs/evolutions.md).
UPDATE pano_data
SET copyright = NULLIF(regexp_replace(regexp_replace(regexp_replace(copyright, '^\s*©\s*', ''),
                                                     '(^|\s*/\s*|\s+)Mapillary(\s*\([^)]*\))?\s*$', ''),
                                      '^\s+|\s+$', '', 'g'), '')
WHERE source::text = 'mapillary' AND copyright ~ '©|Mapillary|^\s|\s$';

-- A Panoramax picture's licence lives in pano_data.license, which the labeler has always sent beside the wrapped
-- copyright, so the parenthetical is normally a duplicate. Should a row have arrived without one, the parenthetical
-- is the only record of the licence CC BY-SA obliges us to name, so it is kept rather than discarded.
UPDATE pano_data
SET copyright = NULLIF(regexp_replace(regexp_replace(regexp_replace(copyright, '^\s*©\s*', ''),
                                                     '(^|\s*/\s*|\s+)Panoramax(\s*\([^)]*\))?\s*$', ''),
                                      '^\s+|\s+$', '', 'g'), ''),
    license = COALESCE(license, NULLIF(btrim(substring(copyright FROM 'Panoramax\s*\(([^)]*)\)\s*$')), ''))
WHERE source::text = 'panoramax' AND copyright ~ '©|Panoramax|^\s|\s$';

# --- !Downs
-- Deliberately empty. The bare name is what the column has always been meant to hold and what every release renders
-- correctly, and nothing records which rows were wrapped, so there is nothing to put back.
