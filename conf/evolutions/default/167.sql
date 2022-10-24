# --- !Ups
ALTER TABLE region RENAME COLUMN description TO name;

-- We are cleaning up the schema for the region table here. Not all of the operations are being undone in the downs
-- because the databases were not exactly lined up with the constraints in Scala, and some constraints were expected but
-- not explicitly stated in Scala as well. Most columns were always assumed to be non-null.
DELETE FROM region WHERE geom IS NULL;
ALTER TABLE region ALTER COLUMN geom SET NOT NULL;

UPDATE region SET data_source = '' WHERE data_source IS NULL;
ALTER TABLE region ALTER COLUMN data_source SET NOT NULL;

UPDATE region SET name = '' WHERE name IS NULL;
ALTER TABLE region ALTER COLUMN name SET NOT NULL;

-- No audit_tasks have a null task_end in any database right now, but adding a check to be safe.
UPDATE audit_task SET task_end = task_start WHERE task_end IS NULL;
ALTER TABLE audit_task ALTER COLUMN task_end SET NOT NULL;

# --- !Downs
ALTER TABLE audit_task ALTER COLUMN task_end DROP NOT NULL;

ALTER TABLE region ALTER COLUMN name DROP NOT NULL;

ALTER TABLE region ALTER COLUMN data_source DROP NOT NULL;

ALTER TABLE region RENAME COLUMN name TO description;
