# --- !Ups
ALTER TABLE organization
    ADD COLUMN is_open BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN is_visible BOOLEAN NOT NULL DEFAULT TRUE;

# --- !Downs
ALTER TABLE organization
    DROP COLUMN is_open,
    DROP COLUMN is_visible;
