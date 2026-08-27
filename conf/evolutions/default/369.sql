# --- !Ups
ALTER TABLE user_route ADD COLUMN paused BOOLEAN NOT NULL DEFAULT FALSE;

# --- !Downs
ALTER TABLE user_route DROP COLUMN paused;
