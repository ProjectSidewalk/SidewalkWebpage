# --- !Ups
ALTER TABLE gsv_data ADD pano_history_saved TIMESTAMP;
CREATE TABLE pano_history (
   pano_id TEXT NOT NULL,
   capture_date TEXT NOT NULL,
   location_current_pano_id TEXT NOT NULL,
   FOREIGN KEY (location_current_pano_id) REFERENCES gsv_data(gsv_panorama_id)
);

-- ALTER TABLE pano_history OWNER TO sidewalk;

# --- !Downs
ALTER TABLE gsv_data DROP pano_history_saved;
DROP TABLE pano_history;
