# --- !Ups
-- Store IP addresses as inet so the database rejects anything that isn't an IP (#5398). The only non-IPs are old junk
-- (faked headers from before v11.8.0, and DC's '' / 'unknown' from 2016-17). Nothing points at those rows, so they're
-- deleted. Changing the type rewrites each table, which takes about 10s for the largest city.
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
-- host() gives the bare address. A plain cast would add /32 to each one.
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
