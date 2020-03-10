# --- !Ups
CREATE TABLE user_stat
(
    user_stat_id SERIAL NOT NULL,
    user_id TEXT NOT NULL,
    meters_audited DOUBLE PRECISION NOT NULL,
    labels_per_meter DOUBLE PRECISION,
    high_quality BOOLEAN NOT NULL,
    high_quality_manual BOOLEAN,
    PRIMARY KEY (user_stat_id),
    FOREIGN KEY (user_id) REFERENCES sidewalk_user(user_id)
);

INSERT INTO user_stat (user_id, meters_audited, labels_per_meter, high_quality, high_quality_manual)
    SELECT sidewalk_user.user_id, COALESCE(meters_audited, 0), labels_per_meter, COALESCE(labels_per_meter > 0.0375, TRUE), NULL
    FROM (
        SELECT user_id, meters_audited, label_count / meters_audited AS labels_per_meter
        FROM (
            SELECT user_id, SUM(label_count) AS label_count, COALESCE(SUM(distance_progress), 0) AS meters_audited
            FROM (
                SELECT sidewalk_user.user_id, distance_progress, COALESCE(COUNT(label.label_id), 0) AS label_count
                FROM sidewalk_user
                LEFT JOIN mission ON sidewalk_user.user_id = mission.user_id
                LEFT JOIN label ON mission.mission_id = label.mission_id
                WHERE mission.mission_type_id = 2 OR mission.mission_type_id IS NULL
                GROUP BY sidewalk_user.user_id, mission.mission_id, distance_progress
            ) label_counts
            GROUP BY user_id
        ) distance_and_count
        WHERE meters_audited > 0
    ) labeling_freq
    RIGHT JOIN sidewalk_user ON labeling_freq.user_id = sidewalk_user.user_id;

# --- !Downs
DROP TABLE user_stat;
