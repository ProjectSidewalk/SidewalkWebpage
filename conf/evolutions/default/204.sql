# --- !Ups
-- just a check, no instances of this in the live database when ran.
UPDATE label SET temporary_label_id = -1 WHERE temporary_label_id IS NULL;
ALTER TABLE label ALTER COLUMN temporary_label_id SET NOT NULL;

# --- !Downs
ALTER TABLE label ALTER COLUMN temporary_label_id DROP NOT NULL;
UPDATE label SET temporary_label_id = NULL WHERE temporary_label_id = -1;
