# --- !Ups
ALTER TABLE label_ai_assessment ADD COLUMN tags_not_present TEXT[] DEFAULT '{}';

# --- !Downs
ALTER TABLE label_ai_assessment DROP COLUMN tags_not_present;
