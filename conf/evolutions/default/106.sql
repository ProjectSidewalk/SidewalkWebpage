# --- !Ups
ALTER TABLE user_attribute
    DROP CONSTRAINT user_attribute_user_clustering_session_id_fkey,
    ADD CONSTRAINT user_attribute_user_clustering_session_id_fkey
        FOREIGN KEY (user_clustering_session_id)
            REFERENCES user_clustering_session(user_clustering_session_id)
            ON DELETE CASCADE;

ALTER TABLE user_attribute_label
    DROP CONSTRAINT user_attribute_label_user_attribute_id_fkey,
    ADD CONSTRAINT user_attribute_label_user_attribute_id_fkey
        FOREIGN KEY (user_attribute_id)
            REFERENCES user_attribute(user_attribute_id)
            ON DELETE CASCADE;

ALTER TABLE global_attribute_user_attribute
    DROP CONSTRAINT global_attribute_user_attribute_user_attribute_id_fkey,
    ADD CONSTRAINT global_attribute_user_attribute_user_attribute_id_fkey
        FOREIGN KEY (user_attribute_id)
            REFERENCES user_attribute(user_attribute_id)
            ON DELETE CASCADE;

CREATE INDEX user_attribute_user_clustering_session_id_idx ON user_attribute USING btree(user_clustering_session_id);
CREATE INDEX global_attribute_user_attribute_user_attribute_id_idx ON global_attribute_user_attribute USING btree(user_attribute_id);
CREATE INDEX user_attribute_label_user_attribute_id_idx ON user_attribute_label USING btree(user_attribute_id);

# --- !Downs
DROP INDEX IF EXISTS user_attribute_label_user_attribute_id_idx;
DROP INDEX IF EXISTS global_attribute_user_attribute_user_attribute_id_idx;
DROP INDEX IF EXISTS user_attribute_user_clustering_session_id_idx;

ALTER TABLE global_attribute_user_attribute
    DROP CONSTRAINT global_attribute_user_attribute_user_attribute_id_fkey,
    ADD CONSTRAINT global_attribute_user_attribute_user_attribute_id_fkey
        FOREIGN KEY (user_attribute_id)
            REFERENCES user_attribute(user_attribute_id);

ALTER TABLE user_attribute_label
    DROP CONSTRAINT user_attribute_label_user_attribute_id_fkey,
    ADD CONSTRAINT user_attribute_label_user_attribute_id_fkey
        FOREIGN KEY (user_attribute_id)
            REFERENCES user_attribute(user_attribute_id);

ALTER TABLE user_attribute
    DROP CONSTRAINT user_attribute_user_clustering_session_id_fkey,
    ADD CONSTRAINT user_attribute_user_clustering_session_id_fkey
        FOREIGN KEY (user_clustering_session_id)
            REFERENCES user_clustering_session(user_clustering_session_id);
