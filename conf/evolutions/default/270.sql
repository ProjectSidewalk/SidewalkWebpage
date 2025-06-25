# --- !Ups

CREATE TABLE user_clustering_session_published
  (LIKE user_clustering_session INCLUDING ALL);

CREATE TABLE user_attribute_published
  (LIKE user_attribute INCLUDING ALL);

CREATE TABLE user_attribute_label_published
  (LIKE user_attribute_label INCLUDING ALL);

# --- !Down

DROP TABLE IF EXISTS user_clustering_session_published;
DROP TABLE IF EXISTS user_attribute_published;
DROP TABLE IF EXISTS user_attribute_label_published;
