# --- !Ups
ALTER TABLE pano_data ADD COLUMN source_metadata JSONB;

# --- !Downs
ALTER TABLE pano_data DROP COLUMN source_metadata;
