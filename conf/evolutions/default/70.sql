# --- !Ups
UPDATE label_type SET description = 'Other' WHERE label_type = 'Other';

# --- !Downs
UPDATE label_type SET description = '' WHERE label_type = 'Other';
