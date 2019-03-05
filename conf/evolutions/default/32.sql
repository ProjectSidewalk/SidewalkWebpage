# --- !Ups
UPDATE tag SET tag = 'trash/recycling can' WHERE tag = 'trash can';

# --- !Downs
UPDATE tag SET tag = 'trash can' WHERE tag = 'trash/recycling can';
