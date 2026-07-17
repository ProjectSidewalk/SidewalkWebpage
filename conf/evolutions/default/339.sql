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
-- #4054 (the first increment only writes 'photo' rows). capture_recency and near_label are the coarse signals the card
-- shows. photo_captured_at/photo_lat/photo_lng hold the raw EXIF capture time and GPS (when present), kept for our own
-- internal analysis only -- they are never emitted in any API response, export, or UI, and the re-encoded served image
-- carries no EXIF. alt_text NULL means the author explicitly skipped the description.
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
    photo_captured_at TIMESTAMPTZ,
    photo_lat DOUBLE PRECISION,
    photo_lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE story_media OWNER TO sidewalk;
CREATE INDEX story_media_story_id_idx ON story_media (story_id);

-- Register the story-surface ui_source values (#4054): validations cast from the label popup opened off the user
-- dashboard's "Your stories" list (DashboardStories) and the admin moderation queue (AdminStories). Without these the
-- vote POST's source fails UiSource.withName and the validation is silently dropped. Kept in sync with the UiSource
-- Scala enum in CommonUtils.scala. Adding a value inside a transaction is fine on PG 12+ as long as the same
-- transaction doesn't use it, and this evolution doesn't. IF NOT EXISTS guards re-application across city schemas.
-- Enum types need no OWNER TO reassignment -- the app role's default USAGE is sufficient and they are never altered
-- at runtime.
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'DashboardStories';
ALTER TYPE ui_source ADD VALUE IF NOT EXISTS 'AdminStories';

# --- !Downs
-- The ui_source portion is intentionally not reverted. Postgres cannot drop an enum value without recreating the type
-- and recasting every column that references it (label_history, label_validation, validation_task_interaction). An
-- unused extra enum value is harmless, so removing it is not worth a full type rebuild (331.sql precedent).
DROP TABLE story_media;
DROP TABLE story;
DROP TYPE story_visibility;
