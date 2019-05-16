# --- !Ups
CREATE TABLE user_stat
(
    user_stats_id INT NOT NULL,
    user_id TEXT NOT NULL,
    meters_audited DOUBLE PRECISION NOT NULL,
    labels_per_meter DOUBLE PRECISION,
    high_quality BOOLEAN NOT NULL,
    high_quality_manual BOOLEAN,
    PRIMARY KEY (user_stats_id),
    FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id)
);

# --- !Downs
DROP TABLE user_stat;
