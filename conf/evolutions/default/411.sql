# --- !Ups
-- #5407: nothing lets a Mapillary deployment favour imagery from particular contributors. The pano viewer's location
-- search, the street imagery scan and the nightly imagery-age poll all rank every public 360 image in a bounding box
-- alike, so imagery we collected ourselves can lose to an older capture a few meters closer.

-- The Mapillary sources this deployment favours, managed from /admin/imagery. An empty table means no source is
-- favoured, which is every deployment's state until an admin adds one. What a listed source does is
-- config.mapillary_source_mode below.
CREATE TABLE mapillary_source (
  -- What kind of thing source_value names. Only 'creator' (a Mapillary username) exists so far. A plain CHECK
  -- rather than an enum type, per docs/evolutions.md: this is a tiny admin-seeded config table.
  source_type TEXT NOT NULL CHECK (source_type IN ('creator')),
  -- The Mapillary username as Mapillary spells it. Its username lookup ignores case, but images carry this spelling and
  -- the viewer compares it exactly, so the app stores what Mapillary returns rather than what an admin typed.
  source_value TEXT NOT NULL CHECK (source_value <> '' AND source_value = btrim(source_value)),
  -- The admin who added the source. NULL only for a row added outside /admin/imagery, by hand in SQL.
  added_by TEXT REFERENCES sidewalk_login.sidewalk_user (user_id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_value)
);
ALTER TABLE mapillary_source OWNER TO sidewalk;

-- How the listed sources apply. 'prefer': a listed creator's pano wins when one is close enough to the target
-- (pano-scoring.json preferredCreatorMaxDistanceMeters), and everyone's imagery is used otherwise, so which streets
-- have imagery is unchanged. 'restrict': only listed creators' imagery is used at all, which also needs the street
-- imagery scan re-run with the same creators to hide the streets they never covered. Ignored while the table is empty.
ALTER TABLE config
  ADD COLUMN mapillary_source_mode TEXT NOT NULL DEFAULT 'prefer'
    CHECK (mapillary_source_mode IN ('prefer', 'restrict'));

# --- !Downs
ALTER TABLE config DROP COLUMN mapillary_source_mode;
DROP TABLE mapillary_source;
