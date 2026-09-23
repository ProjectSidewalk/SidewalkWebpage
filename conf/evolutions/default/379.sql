# --- !Ups
-- Where the label sits in its crop image (#2660). A crop at <crops>/<LabelType>/crop_<id>.png is one of two things
-- that look alike on disk: the browser's 1440x960 snapshot of the Explore canvas at labeling time (POST /saveImage),
-- in which the label is at canvas_x/720, canvas_y/480 -- or the window the nightly job (#4865) cuts around the label
-- from the self-hosted pano, in which the label is at the centre unless the window had to shift off a pole. Every
-- consumer that draws a marker on a crop -- the Gallery card, the popup's crop fallback, the share preview -- assumed
-- the first, so on the job's crops the marker landed a median 190 px (of 720) from the feature. This table says which
-- kind each crop is and where the label is in it, so a consumer asks rather than assumes.
CREATE TYPE crop_source AS ENUM ('explore_frame', 'pano_window');
CREATE TABLE label_crop (
    label_id INTEGER PRIMARY KEY REFERENCES label (label_id),
    source crop_source NOT NULL,
    -- The label's position as fractions of the stored image's width and height, so it survives any display scaling.
    marker_x DOUBLE PRECISION NOT NULL CHECK (marker_x >= 0 AND marker_x <= 1),
    marker_y DOUBLE PRECISION NOT NULL CHECK (marker_y >= 0 AND marker_y <= 1),
    -- The stored file's dimensions when the row was written.
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    -- CropSizingRule.Version for a pano_window crop, and NULL for an explore_frame one (sized by no rule).
    crop_rule_version TEXT CHECK ((crop_rule_version IS NOT NULL) = (source = 'pano_window')),
    time_created TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE label_crop OWNER TO sidewalk;
-- No backfill here. Existing crops get their rows from the crop job's reconcile pass, which has to read each file's
-- dimensions and mtime to tell the two kinds apart: filesystem work an evolution running on 50+ schemas must not do.

# --- !Downs
DROP TABLE label_crop;
DROP TYPE crop_source;
