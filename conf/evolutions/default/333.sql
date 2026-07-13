# --- !Ups
-- Rename the API-docs preview logging tag from `source=apiDocs` to `utm_source=apiDocs` in existing webpage_activity
-- rows, to prevent collision with `source` parameters in our API (#4527).
UPDATE webpage_activity
SET activity = REPLACE(activity, '?source=apiDocs', '?utm_source=apiDocs')
WHERE activity LIKE '%?source=apiDocs%';

UPDATE webpage_activity
SET activity = REPLACE(activity, '&source=apiDocs', '&utm_source=apiDocs')
WHERE activity LIKE '%&source=apiDocs%';

# --- !Downs
UPDATE webpage_activity
SET activity = REPLACE(activity, '?utm_source=apiDocs', '?source=apiDocs')
WHERE activity LIKE '%?utm_source=apiDocs%';

UPDATE webpage_activity
SET activity = REPLACE(activity, '&utm_source=apiDocs', '&source=apiDocs')
WHERE activity LIKE '%&utm_source=apiDocs%';
