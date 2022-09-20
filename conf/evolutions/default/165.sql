# --- !Ups
ALTER TABLE user_role
    ADD COLUMN community_service BOOLEAN NOT NULL DEFAULT FALSE;

# --- !Downs
ALTER TABLE user_role
    DROP COLUMN community_service;
