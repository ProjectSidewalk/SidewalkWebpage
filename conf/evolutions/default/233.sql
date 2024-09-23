# --- !Ups
ALTER TABLE gsv_data ADD COLUMN last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE gsv_data SET last_checked = last_viewed;

# --- !Downs
ALTER TABLE gsv_data DROP COLUMN last_checked;
