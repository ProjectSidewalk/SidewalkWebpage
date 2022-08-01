# --- !Ups
DROP TABLE mission_progress_cvgroundtruth;

# --- !Downs
CREATE TABLE mission_progress_cvgroundtruth (
    item_id BIGSERIAL,
    linked_mission_id INT,
    panoid VARCHAR(64),
    completed BOOLEAN,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    PRIMARY KEY (item_id),
    FOREIGN KEY (linked_mission_id) REFERENCES mission(mission_id)
);
