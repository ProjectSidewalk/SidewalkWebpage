
# --- !Ups
ALTER TABLE gt_label
  ALTER COLUMN description DROP NOT NULL;

ALTER TABLE gt_label
  ALTER COLUMN severity DROP NOT NULL;

ALTER TABLE gt_label
  ALTER COLUMN temporary_problem DROP NOT NULL;

# --- !Downs
ALTER TABLE gt_label
  ALTER COLUMN description SET NOT NULL;

ALTER TABLE gt_label
  ALTER COLUMN severity SET NOT NULL;

ALTER TABLE gt_label
  ALTER COLUMN temporary_problem SET NOT NULL;
