# --- !Ups
TRUNCATE TABLE amt_assignment;
ALTER TABLE amt_assignment ALTER COLUMN confirmation_code SET NOT NULL;

# --- !Downs

ALTER TABLE amt_assignment ALTER COLUMN confirmation_code DROP NOT NULL;
