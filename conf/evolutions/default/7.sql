
# --- !Ups
ALTER TABLE amt_assignment
  ADD accepted BOOLEAN;


# --- !Downs
ALTER TABLE amt_assignment
  DROP accepted;
