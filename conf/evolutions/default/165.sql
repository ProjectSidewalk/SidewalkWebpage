# --- !Ups
ALTER TABLE user_role
    ADD COLUMN community_service BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE label ALTER COLUMN time_created SET NOT NULL;

# --- !Downs
ALTER TABLE label ALTER COLUMN time_created DROP NOT NULL;

ALTER TABLE user_role
    DROP COLUMN community_service;
