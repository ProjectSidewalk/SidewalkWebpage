# --- !Ups
-- Replace old clustering tables with new ones that are more simplified.
CREATE TABLE IF NOT EXISTS clustering_session (
    clustering_session_id SERIAL PRIMARY KEY,
    region_id INT NOT NULL REFERENCES region(region_id),
    thresholds jsonb NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE clustering_session OWNER TO sidewalk;

CREATE TABLE IF NOT EXISTS cluster (
    cluster_id SERIAL PRIMARY KEY,
    clustering_session_id INT NOT NULL REFERENCES clustering_session(clustering_session_id) ON DELETE CASCADE,
    street_edge_id INT NOT NULL REFERENCES street_edge(street_edge_id),
    label_type_id INT NOT NULL REFERENCES label_type(label_type_id),
    geom geometry(Point, 4326) NOT NULL,
    severity INT
);
ALTER TABLE cluster OWNER TO sidewalk;
CREATE INDEX idx_cluster_geom ON cluster USING GIST (geom);

CREATE TABLE IF NOT EXISTS cluster_label (
    cluster_label_id SERIAL PRIMARY KEY,
    cluster_id INT NOT NULL REFERENCES cluster(cluster_id) ON DELETE CASCADE,
    label_id INT NOT NULL REFERENCES label(label_id)
);
ALTER TABLE cluster_label OWNER TO sidewalk;

DROP TABLE IF EXISTS global_attribute_user_attribute;
DROP TABLE IF EXISTS global_attribute;
DROP TABLE IF EXISTS global_clustering_session;
DROP TABLE IF EXISTS user_attribute_label;
DROP TABLE IF EXISTS user_attribute;
DROP TABLE IF EXISTS user_clustering_session;

# --- !Downs
-- Reverse it: drop new tables, recreate old ones.
DROP TABLE IF EXISTS cluster_label;
DROP TABLE IF EXISTS cluster;
DROP TABLE IF EXISTS clustering_session;

CREATE TABLE user_clustering_session
(
    user_clustering_session_id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES sidewalk_user (user_id),
    time_created timestamp default current_timestamp NOT NULL
);

CREATE TABLE user_attribute
(
    user_attribute_id SERIAL PRIMARY KEY,
    user_clustering_session_id INT NOT NULL REFERENCES user_clustering_session(user_clustering_session_id),
    clustering_threshold DOUBLE PRECISION NOT NULL,
    label_type_id INT NOT NULL REFERENCES label_type(label_type_id),
    region_id INT NOT NULL REFERENCES region(region_id),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    severity INT
);

CREATE TABLE user_attribute_label
(
    user_attribute_label_id SERIAL PRIMARY KEY,
    user_attribute_id INT NOT NULL REFERENCES user_attribute(user_attribute_id),
    label_id INT NOT NULL REFERENCES label(label_id)
);

CREATE TABLE global_clustering_session
(
    global_clustering_session_id SERIAL PRIMARY KEY,
    region_id INT NOT NULL REFERENCES region(region_id),
    time_created timestamp default current_timestamp NOT NULL
);

CREATE TABLE global_attribute
(
    global_attribute_id SERIAL PRIMARY KEY,
    global_clustering_session_id INT NOT NULL REFERENCES global_clustering_session(global_clustering_session_id),
    clustering_threshold DOUBLE PRECISION NOT NULL,
    label_type_id INT NOT NULL REFERENCES label_type(label_type_id),
    region_id INT NOT NULL REFERENCES region(region_id),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    severity INT
);

CREATE TABLE global_attribute_user_attribute
(
    global_attribute_user_attribute_id SERIAL PRIMARY KEY,
    global_attribute_id INT NOT NULL REFERENCES global_attribute(global_attribute_id),
    user_attribute_id INT NOT NULL REFERENCES user_attribute(user_attribute_id)
);
