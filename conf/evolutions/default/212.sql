# --- !Ups
ALTER TABLE config ADD COLUMN make_crops BOOLEAN DEFAULT TRUE;

# --- !Downs
ALTER TABLE config DROP COLUMN make_crops;
