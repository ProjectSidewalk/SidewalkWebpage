# --- !Ups
ALTER TABLE gsv_data ADD COLUMN pano_history_saved TIMESTAMPTZ;

CREATE TABLE pano_history (
    pano_id TEXT NOT NULL,
    capture_date TEXT NOT NULL,
    location_curr_pano_id TEXT NOT NULL,
    FOREIGN KEY (location_curr_pano_id) REFERENCES gsv_data(gsv_panorama_id)
);
ALTER TABLE pano_history OWNER TO sidewalk; -- This just helps us give table correct permissions on prod server.

# --- !Downs
DROP TABLE pano_history;

ALTER TABLE gsv_data DROP COLUMN pano_history_saved;
