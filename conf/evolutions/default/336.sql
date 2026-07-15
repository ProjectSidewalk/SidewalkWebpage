# --- !Ups
ALTER TABLE pano_data ADD COLUMN address TEXT;

# --- !Downs
ALTER TABLE pano_data DROP COLUMN address;
