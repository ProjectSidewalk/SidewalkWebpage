# --- !Ups
-- Unwraps the attribution the AI labeler composed around a Mapillary or Panoramax contributor's name in
-- pano_data.copyright, "© jacobwhall / Mapillary (CC BY-SA 4.0)" or "© Arretche / Panoramax (CC-BY-SA-4.0)", back to
-- the bare name the live viewers record, "jacobwhall" (#5360). ImageryAttribution composes the sign, the provider and
-- the licence around the column itself, so the wrapped form read "© © jacobwhall / Mapillary (CC BY-SA 4.0) ·
-- Mapillary · CC BY-SA 4.0" wherever a crop or a self-hosted pano is shown. A wrapper naming only the provider
-- recorded no contributor, so it becomes NULL, which is how the column reads that. The two expressions are the ones
-- ImageryAttribution.normalizeCopyright now applies to every submission, so no such row is written again.
-- pano_data has no index on source or copyright, so each statement is one sequential scan of the table, under a
-- second on the largest schema, and only the rows the AI labeler wrote for these two sources are updated.
UPDATE pano_data
SET copyright = NULLIF(btrim(regexp_replace(regexp_replace(copyright, '^\s*©\s*', ''),
                                            '(^|\s*/\s*|\s+)Mapillary(\s*\([^)]*\))?\s*$', '')), '')
WHERE source = 'mapillary' AND copyright ~ '©|Mapillary';

UPDATE pano_data
SET copyright = NULLIF(btrim(regexp_replace(regexp_replace(copyright, '^\s*©\s*', ''),
                                            '(^|\s*/\s*|\s+)Panoramax(\s*\([^)]*\))?\s*$', '')), '')
WHERE source = 'panoramax' AND copyright ~ '©|Panoramax';

# --- !Downs
-- Deliberately empty. The bare name is what the column has always been meant to hold and what every release renders
-- correctly, and nothing records which rows were wrapped, so there is nothing to put back.
