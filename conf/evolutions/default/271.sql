# --- !Ups
CREATE TABLE user_clustering_session_cached (LIKE user_clustering_session INCLUDING ALL);

CREATE TABLE user_attribute_cached (LIKE user_attribute INCLUDING ALL);

CREATE TABLE user_attribute_label_cached (LIKE user_attribute_label INCLUDING ALL);

CREATE TABLE global_clustering_session_cached (LIKE global_clustering_session INCLUDING ALL);

CREATE TABLE global_attribute_cached (LIKE global_attribute INCLUDING ALL);

CREATE TABLE global_attribute_user_attribute_cached (LIKE global_attribute_user_attribute INCLUDING ALL);

# --- !Downs

DROP TABLE IF EXISTS user_clustering_session_cached;
DROP TABLE IF EXISTS user_attribute_cached;
DROP TABLE IF EXISTS user_attribute_label_cached;
DROP TABLE IF EXISTS global_clustering_session_cached;
DROP TABLE IF EXISTS global_attribute_cached;
DROP TABLE IF EXISTS global_attribute_user_attribute_cached;