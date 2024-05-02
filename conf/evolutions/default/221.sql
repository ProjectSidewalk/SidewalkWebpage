# --- !Ups
CREATE TABLE pano_history (
   pano_id TEXT NOT NULL,
   capture_date TEXT NOT NULL,
   location_current_pano_id TEXT NOT NULL,
   FOREIGN KEY (location_current_pano_id) REFERENCES gsv_data(gsv_panorama_id)
);

ALTER TABLE gsv_data ADD COLUMN pano_history_saved TIMESTAMP;
ALTER TABLE pano_history OWNER TO sidewalk;

# --- !Downs
DROP TABLE pano_history;
ALTER TABLE gsv_data DROP COLUMN pano_history_saved;