# --- !Ups
-- Lived-experience stories (#4054): a user's personal story about how the barrier at a label affected them, with
-- optional attached media. Stories are public on submit and retractable: the author can hard-DELETE their own story
-- (row and media bytes), while admins quarantine with visibility='hidden' (reversible, preserves abuse evidence) or
-- hard-delete. One story per user per label. Media rows ride along and cascade on story deletion.
-- Visibility is a first-class enum (street_edge_status precedent, 325.sql) because it round-trips through app code
-- and toggles at runtime. The write-once discriminators below stay TEXT + CHECK.
CREATE TYPE story_visibility AS ENUM ('visible', 'hidden');

CREATE TABLE story (
    story_id SERIAL PRIMARY KEY,
    label_id INTEGER NOT NULL REFERENCES label (label_id),
    user_id TEXT NOT NULL REFERENCES sidewalk_login.sidewalk_user (user_id),
    story_text TEXT NOT NULL,
    display_name_mode TEXT NOT NULL DEFAULT 'anonymous' CHECK (display_name_mode IN ('anonymous', 'username')),
    visibility story_visibility NOT NULL DEFAULT 'visible',
    moderated_by TEXT,
    moderated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (label_id, user_id)
);
ALTER TABLE story OWNER TO sidewalk;
CREATE INDEX story_user_id_idx ON story (user_id);
CREATE INDEX story_created_at_idx ON story (created_at);

-- Media attached to a story. media_type/mime_type/duration_secs are provisioned for the audio/video increments of
-- #4054 (the first increment only writes 'photo' rows). capture_recency and near_label are the only values kept from
-- upload metadata (EXIF/MP4 atoms): precise GPS coordinates and timestamps are read transiently for these two derived
-- fields and then discarded, by design. alt_text NULL means the author explicitly skipped the description.
CREATE TABLE story_media (
    story_media_id SERIAL PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES story (story_id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'audio', 'video')),
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_secs DOUBLE PRECISION,
    file_size_bytes BIGINT,
    alt_text TEXT,
    capture_recency TEXT CHECK (capture_recency IN ('within_week', 'within_month', 'within_year', 'older')),
    near_label BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE story_media OWNER TO sidewalk;
CREATE INDEX story_media_story_id_idx ON story_media (story_id);

# --- !Downs
DROP TABLE story_media;
DROP TABLE story;
DROP TYPE story_visibility;
