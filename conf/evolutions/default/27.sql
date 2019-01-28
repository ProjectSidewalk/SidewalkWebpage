# --- !Ups
TRUNCATE TABLE amt_assignment;
ALTER TABLE amt_assignment ALTER COLUMN confirmation_code SET NOT NULL;
ALTER TABLE amt_assignment ALTER COLUMN assignment_end SET NOT NULL;

# --- !Downs
ALTER TABLE amt_assignment ALTER COLUMN assignment_end DROP NOT NULL;
ALTER TABLE amt_assignment ALTER COLUMN confirmation_code DROP NOT NULL;
