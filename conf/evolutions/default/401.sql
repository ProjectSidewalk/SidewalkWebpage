# --- !Ups
-- IP addresses as inet (#5398), so non-IPs can't be saved and COUNT(DISTINCT) treats equal addresses as one. Play's
-- parsed client address is always a real IP, so all eight columns can be NOT NULL. The rows that won't convert are
-- pre-v11.8.0 junk from spoofed X-Forwarded-For headers (plus DC's 2016-17 '' / 'unknown'), referenced by nothing.
DELETE FROM webpage_activity WHERE NOT pg_input_is_valid(ip_address, 'inet');
DELETE FROM audit_task_environment WHERE NOT pg_input_is_valid(ip_address, 'inet');

ALTER TABLE webpage_activity ALTER COLUMN ip_address TYPE inet USING ip_address::inet;
ALTER TABLE audit_task_comment ALTER COLUMN ip_address TYPE inet USING ip_address::inet;
ALTER TABLE street_edge_issue ALTER COLUMN ip_address TYPE inet USING ip_address::inet;
ALTER TABLE validation_task_comment ALTER COLUMN ip_address TYPE inet USING ip_address::inet;
ALTER TABLE validation_task_comment_history ALTER COLUMN ip_address TYPE inet USING ip_address::inet;
ALTER TABLE audit_task_environment
  ALTER COLUMN ip_address TYPE inet USING ip_address::inet,
  ALTER COLUMN ip_address SET NOT NULL;
ALTER TABLE validation_task_environment
  ALTER COLUMN ip_address TYPE inet USING ip_address::inet,
  ALTER COLUMN ip_address SET NOT NULL;
ALTER TABLE gallery_task_environment
  ALTER COLUMN ip_address TYPE inet USING ip_address::inet,
  ALTER COLUMN ip_address SET NOT NULL;

# --- !Downs
-- host() rather than a plain cast, which would add a /32 or /128 suffix to every address.
ALTER TABLE gallery_task_environment
  ALTER COLUMN ip_address DROP NOT NULL,
  ALTER COLUMN ip_address TYPE text USING host(ip_address);
ALTER TABLE validation_task_environment
  ALTER COLUMN ip_address DROP NOT NULL,
  ALTER COLUMN ip_address TYPE text USING host(ip_address);
ALTER TABLE audit_task_environment
  ALTER COLUMN ip_address DROP NOT NULL,
  ALTER COLUMN ip_address TYPE text USING host(ip_address);
ALTER TABLE validation_task_comment_history ALTER COLUMN ip_address TYPE text USING host(ip_address);
ALTER TABLE validation_task_comment ALTER COLUMN ip_address TYPE text USING host(ip_address);
ALTER TABLE street_edge_issue ALTER COLUMN ip_address TYPE text USING host(ip_address);
ALTER TABLE audit_task_comment ALTER COLUMN ip_address TYPE text USING host(ip_address);
ALTER TABLE webpage_activity ALTER COLUMN ip_address TYPE text USING host(ip_address);
