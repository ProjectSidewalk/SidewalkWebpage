# --- !Ups
CREATE TABLE pano_history (
   pano_id TEXT NOT NULL,
   visited_timestamp TIMESTAMP,
   pano_date TEXT NOT NULL,
   location_current_pano_id TEXT NOT NULL,
   PRIMARY KEY (pano_id),
   FOREIGN KEY (location_current_pano_id) REFERENCES pano_history(pano_id)
);

# --- !Downs
DROP TABLE pano_history;
