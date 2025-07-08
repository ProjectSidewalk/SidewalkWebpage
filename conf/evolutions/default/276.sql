# --- !Ups
ALTER TABLE label ADD COLUMN gsv_capture_date TEXT;
UPDATE label
SET gsv_capture_date = gsv_data.capture_date
FROM gsv_data
WHERE label.gsv_panorama_id = gsv_data.gsv_panorama_id;

# --- !Downs
ALTER TABLE label DROP COLUMN gsv_capture_date;