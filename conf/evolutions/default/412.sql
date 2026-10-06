# --- !Ups
-- Record what the user points with, so touch use of Explore and Validate can be measured (#5664). A Safari iPad sends a
-- Mac user agent, so nothing stored before this tells it apart from a Mac. Nullable with no default, so old rows read
-- as unknown and the large tables aren't rewritten.
ALTER TABLE audit_task_environment
  ADD COLUMN max_touch_points INT,
  ADD COLUMN primary_pointer TEXT CHECK (primary_pointer IN ('fine', 'coarse', 'none'));
ALTER TABLE validation_task_environment
  ADD COLUMN max_touch_points INT,
  ADD COLUMN primary_pointer TEXT CHECK (primary_pointer IN ('fine', 'coarse', 'none'));

# --- !Downs
ALTER TABLE validation_task_environment DROP COLUMN primary_pointer, DROP COLUMN max_touch_points;
ALTER TABLE audit_task_environment DROP COLUMN primary_pointer, DROP COLUMN max_touch_points;
