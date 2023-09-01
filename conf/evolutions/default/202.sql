# --- !Ups
ALTER TABLE label_validation ADD source TEXT;

UPDATE label_validation SET source = 'ValidateMobile' WHERE is_mobile = TRUE;

ALTER TABLE label_validation DROP COLUMN is_mobile;

# --- !Downs
ALTER TABLE label_validation ADD is_mobile BOOLEAN;

UPDATE label_validation SET is_mobile = (source = 'ValidateMobile');

ALTER TABLE label_validation DROP COLUMN source;
