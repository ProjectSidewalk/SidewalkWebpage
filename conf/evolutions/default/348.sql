# --- !Ups
-- Verbatim imagery-provider metadata for a submitted pano (#4806) -- today, the Mapillary Graph API blob that the
-- auto-labeler sends with every pano. Nullable because only AI submissions carry it: GSV panos and every Explore
-- submission leave it NULL. The blob is a strict superset of the provenance scalars we may promote to real columns
-- later (source_metadata->>'make' and friends), and it is the only copy of that data we hold. The Downs below drops
-- the column and with it the provenance, so the recovery path is an idempotent pano-only re-POST from the labeler.
-- For anything that later exposes this column: the blob embeds the Mapillary uploader's `creator` record, which is
-- third-party personal data and must not be published wholesale.
ALTER TABLE pano_data ADD COLUMN source_metadata JSONB;

-- The blob is a provider metadata document, never a scalar or array. Enforced here rather than in the app alone so
-- the invariant also survives backfills and hand-written SQL. CHECKs have no Slick DSL, so PanoDataTable cannot
-- mirror this one -- the matching app-side guard is the object-only Reads in ExploreFormats.
ALTER TABLE pano_data ADD CONSTRAINT pano_data_source_metadata_check
    CHECK (source_metadata IS NULL OR jsonb_typeof(source_metadata) = 'object');

# --- !Downs
ALTER TABLE pano_data DROP COLUMN source_metadata;
