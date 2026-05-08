# --- !Ups
-- Track labels that the SidewalkAI API has refused permanently (e.g., the imagery is no longer available from Google
-- and we have no cached copy). Rows here cause getLabelsToValidateWithAi to skip the label, so we don't keep retrying.
CREATE TABLE IF NOT EXISTS label_ai_failure (
    label_id INT PRIMARY KEY REFERENCES label (label_id),
    reason TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Record whether the AI API used a freshly-downloaded image or a cached one for each assessment. Older rows all
-- predate the cache option, so they are backfilled to 'download'.
CREATE TYPE ai_image_source AS ENUM ('download', 'cache');
ALTER TABLE label_ai_assessment ADD COLUMN ai_image_source ai_image_source NOT NULL DEFAULT 'download';
ALTER TABLE label_ai_assessment ALTER COLUMN ai_image_source DROP DEFAULT;

# --- !Downs
ALTER TABLE label_ai_assessment DROP COLUMN ai_image_source;
DROP TYPE ai_image_source;

DROP TABLE IF EXISTS label_ai_failure;
