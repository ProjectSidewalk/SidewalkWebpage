# --- !Ups
-- #5407: nothing can restrict a Mapillary deployment to imagery from particular contributors. The pano viewer's
-- location search, the street imagery scan and the nightly imagery-age poll all take every public 360 image in a
-- bounding box, so a deployment cannot run on imagery we collected ourselves.

-- The Mapillary sources this deployment is restricted to, managed from /admin/imagery. An empty table means
-- unfiltered, which is every deployment's state until an admin adds a source, so the restriction is opt-in per city.
-- One row or more turns the restriction on: only imagery from a listed source is discovered.
CREATE TABLE mapillary_allowed_source (
  -- What kind of thing source_value names. Only 'creator' (a Mapillary username) exists so far. A plain CHECK
  -- rather than an enum type, per docs/evolutions.md: this is a tiny admin-seeded config table.
  source_type TEXT NOT NULL CHECK (source_type IN ('creator')),
  -- The Mapillary username, exactly as Mapillary spells it (its creator filters are case-sensitive).
  source_value TEXT NOT NULL CHECK (source_value <> '' AND source_value = btrim(source_value)),
  -- The admin who added the source. NULL when the onboarding tooling seeded it, before any user exists.
  added_by TEXT REFERENCES sidewalk_login.sidewalk_user (user_id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_value)
);
ALTER TABLE mapillary_allowed_source OWNER TO sidewalk;

# --- !Downs
DROP TABLE mapillary_allowed_source;
