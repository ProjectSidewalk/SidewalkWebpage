
# --- !Ups
ALTER TABLE label
    ADD time_created TIMESTAMP;

# --- !Downs
ALTER TABLE label
    DROP time_created;