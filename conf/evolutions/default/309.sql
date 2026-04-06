# --- !Ups
CREATE TABLE IF NOT EXISTS sidewalk_login.user_utm (
    user_utm_id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES sidewalk_login.sidewalk_user(user_id),
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    city_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sidewalk_login.user_utm OWNER TO sidewalk;

CREATE INDEX IF NOT EXISTS idx_user_utm_user_id ON sidewalk_login.user_utm(user_id);
CREATE INDEX IF NOT EXISTS idx_user_utm_source ON sidewalk_login.user_utm(utm_source);
CREATE INDEX IF NOT EXISTS idx_user_utm_campaign ON sidewalk_login.user_utm(utm_campaign);

# --- !Downs
DROP TABLE IF EXISTS sidewalk_login.user_utm;
