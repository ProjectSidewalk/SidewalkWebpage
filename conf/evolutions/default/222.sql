# --- !Ups
ALTER TABLE gsv_data ADD COLUMN pano_history_saved TIMESTAMP;

# --- !Downs
ALTER TABLE gsv_data DROP COLUMN pano_history_saved;
