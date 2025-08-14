# --- !Ups
-- Fixes IP addresses that have multiple values separated by commas to only show the first.
UPDATE audit_task_comment SET ip_address = TRIM(SPLIT_PART(ip_address, ',', 1)) WHERE ip_address LIKE '%,%';
UPDATE audit_task_environment SET ip_address = TRIM(SPLIT_PART(ip_address, ',', 1)) WHERE ip_address LIKE '%,%';
UPDATE gallery_task_environment SET ip_address = TRIM(SPLIT_PART(ip_address, ',', 1)) WHERE ip_address LIKE '%,%';
UPDATE street_edge_issue SET ip_address = TRIM(SPLIT_PART(ip_address, ',', 1)) WHERE ip_address LIKE '%,%';
UPDATE validation_task_comment SET ip_address = TRIM(SPLIT_PART(ip_address, ',', 1)) WHERE ip_address LIKE '%,%';
UPDATE validation_task_environment SET ip_address = TRIM(SPLIT_PART(ip_address, ',', 1)) WHERE ip_address LIKE '%,%';
UPDATE webpage_activity SET ip_address = TRIM(SPLIT_PART(ip_address, ',', 1)) WHERE ip_address LIKE '%,%';

# --- !Downs
-- No way to revert this change as the old data is lost. Would need to restore from a backup if necessary.
