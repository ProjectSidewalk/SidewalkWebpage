# --- !Ups
UPDATE mission
SET completed = TRUE
WHERE completed = FALSE AND labels_progress = 10 AND labels_validated = 10;

# --- !Downs
