
# --- !Ups
ALTER TABLE label DROP COLUMN if exists time_created; 
ALTER TABLE label
    ADD time_created TIMESTAMP;

# --- !Downs
ALTER TABLE label
    DROP time_created;
