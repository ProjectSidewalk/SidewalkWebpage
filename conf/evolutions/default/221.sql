# --- !Ups
CREATE TABLE panorama_history (
   panorama_id TEXT NOT NULL,
   visited_timestamp TIMESTAMP,
   pano_month INT NOT NULL,
   pano_year INT NOT NULL,
   location_current_pano_id TEXT NOT NULL,
   PRIMARY KEY (panorama_id),
   FOREIGN KEY (location_current_pano_id) REFERENCES panorama_history(panorama_id)
);

# --- !Downs
DROP TABLE panorama_history;