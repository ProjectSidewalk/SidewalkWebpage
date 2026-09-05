# --- !Ups
-- Community Partners (#4516): admin-managed logos on the landing page. Lives in the shared sidewalk_login schema —
-- city_id NULL means a global partner shown on every deployment, otherwise the row belongs to that one city. City ids
-- come from conf/cityparams.conf, not a DB table, so city_id can't carry an FK — the app only ever writes its own
-- city's id. Logo bytes are stored in the row (not on disk): they're tiny after server-side re-encoding, every one of
-- the ~57 separately-deployed app instances must see globally-scoped logos, and the shared DB is the only substrate
-- they all share (media dirs are per-instance env config, and on-disk media has been wiped by deploys before, #4925).
-- Evolutions run once per city schema, so all DDL here is IF NOT EXISTS (309.sql precedent) — the table is created on
-- the first schema's run and every later run is a no-op. display_order is a dense 0..n-1 sequence within each scope
-- (a city_id value, or the NULL/global scope), rewritten transactionally on reorder. It is not UNIQUE-constrained
-- because a swap would then need deferred constraints for no integrity value on a handful of rows.
CREATE TABLE IF NOT EXISTS sidewalk_login.partner (
    partner_id SERIAL PRIMARY KEY,
    city_id TEXT,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    url TEXT,
    alt_text TEXT,
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    logo_image BYTEA NOT NULL CHECK (octet_length(logo_image) <= 1048576),  -- = PartnerServiceImpl.MAX_LOGO_BYTES
    logo_mime_type TEXT NOT NULL CHECK (logo_mime_type IN ('image/png', 'image/jpeg')),
    logo_width INTEGER NOT NULL CHECK (logo_width > 0),
    logo_height INTEGER NOT NULL CHECK (logo_height > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT NOT NULL REFERENCES sidewalk_login.sidewalk_user (user_id),
    updated_by TEXT NOT NULL REFERENCES sidewalk_login.sidewalk_user (user_id)
);
ALTER TABLE sidewalk_login.partner OWNER TO sidewalk;

CREATE INDEX IF NOT EXISTS partner_city_id_idx ON sidewalk_login.partner (city_id);

# --- !Downs
-- The table is shared: reverting this evolution in ANY one schema (including a local renumber-after-merge, where
-- autoApplyDowns runs) drops every city's uploaded logos, not just the reverting city's.
DROP TABLE IF EXISTS sidewalk_login.partner;
