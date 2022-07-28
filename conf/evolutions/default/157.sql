# --- !Ups
-- Remove severity for Pedestrian Signal labels.
UPDATE label SET severity = NULL WHERE label_type_id = 10;

# --- !Downs
