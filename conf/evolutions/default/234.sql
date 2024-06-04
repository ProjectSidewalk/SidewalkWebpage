# --- !Ups
UPDATE validation_options SET text = 'unsure' WHERE text = 'notsure';
ALTER TABLE label RENAME COLUMN notsure_count TO unsure_count;

# --- !Downs
ALTER TABLE label RENAME COLUMN unsure_count TO notsure_count;
UPDATE validation_options SET text = 'notsure' WHERE text = 'unsure';
