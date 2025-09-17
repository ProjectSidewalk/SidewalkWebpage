# --- !Ups
-- Clears the pano_history table because nearly all the data was messed up.
-- https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4016
TRUNCATE TABLE pano_history;

# --- !Downs
